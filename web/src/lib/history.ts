/* Every advance this business has taken, read back off the chain.

   The record is the product. Float's pitch is that a repayment history is
   portable and verifiable by anyone, and until now the app showed it as two
   counters — "6 repayments, $25,380 repaid" — which is a summary of the
   thing rather than the thing.

   The advances themselves are not sitting in accounts to be fetched. One Loan
   PDA per borrower is reused and overwritten each cycle, with a nonce marking
   which advance it currently holds. What survives is the events: Drawn,
   Repaid and Liquidated are emitted on every cycle and stay in the
   transaction log forever.

   So the history is reconstructed from the loan account's own signatures. It
   is slower than reading an account and it is bounded by what the RPC will
   still serve, which is the honest trade for not having written a second
   account per advance purely so a screen could read it back. */

import { PublicKey } from "@solana/web3.js";
import { connection, program, loanPda, legacyLoanPda } from "./chain";

export type Advance = {
  nonce: number;
  /** "drawn" until it is settled; then how it ended. */
  status: "drawn" | "repaid" | "liquidated";
  principal: bigint;
  fee: bigint;
  totalDue: bigint;
  marginBps: number;
  termDays: number;
  collateral: "feeStream" | "token";
  drawnAt: number | null;
  settledAt: number | null;
  /** Repayments only. */
  coveredByFees: bigint;
  toppedUp: bigint;
  wasLate: boolean;
  /** Liquidations only. */
  seized: bigint;
  drawTx: string | null;
  settleTx: string | null;
};

const big = (v: any) => BigInt(v.toString());

/** Decode Float's own events out of a transaction's program logs. */
function eventsIn(logs: string[] | null | undefined) {
  if (!logs) return [];
  const out: { name: string; data: any }[] = [];
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    try {
      const decoded = program.coder.events.decode(m[1]);
      if (decoded) out.push({ name: decoded.name, data: decoded.data });
    } catch { /* another program's data, or a format we do not read */ }
  }
  return out;
}

const blank = (nonce: number): Advance => ({
  nonce, status: "drawn",
  principal: 0n, fee: 0n, totalDue: 0n, marginBps: 0, termDays: 0,
  collateral: "feeStream", drawnAt: null, settledAt: null,
  coveredByFees: 0n, toppedUp: 0n, wasLate: false, seized: 0n,
  drawTx: null, settleTx: null,
});

/* A settled advance never changes, and its transaction never changes at all,
   so a decoded transaction is cached by signature. Devnet's public endpoint
   rate-limits getTransaction hard enough that a six-cycle history cannot be
   read in one pass without this; with it, only the newest advance costs
   anything on a revisit.

   Cache misses are the normal case on a first visit and must stay correct
   without it, so every read and write is guarded. */
const CACHE_KEY = "float.history.v1";

type CachedEvents = { name: string; data: any }[];

function readCache(): Record<string, any> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeCache(next: Record<string, any>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* full, or blocked */ }
}

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e: unknown) => /429|too many requests/i.test(String(e));

/** One transaction, with backoff on the rate limit rather than a silent null. */
async function fetchLogs(signature: string): Promise<string[] | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      return tx?.meta?.logMessages ?? [];
    } catch (e) {
      if (!isRateLimit(e) || attempt === 3) return null;
      await nap(400 * 2 ** attempt);
    }
  }
  return null;
}

export type History = {
  advances: Advance[];
  /** True when the RPC refused part of the range, so the list is short. */
  truncated: boolean;
};

/** Newest first. `limit` bounds how far back the RPC is asked to go. */
export async function getHistory(wallet: PublicKey, limit = 40): Promise<History> {
  /* Both loan addresses.

     Versioning the Loan PDA gave this borrower a new address, and the
     advances they took before that are recorded against the old one. Reading
     only the current address would show a business with six repayments an
     empty history, which is the opposite of the point. */
  const addresses = [loanPda(wallet), legacyLoanPda(wallet)];

  const lists = await Promise.all(
    addresses.map((a) =>
      connection
        .getSignaturesForAddress(a, { limit }, "confirmed")
        .catch(() => []),
    ),
  );

  const seen = new Set<string>();
  const sigs = lists
    .flat()
    .filter((s) => !s.err && !seen.has(s.signature) && seen.add(s.signature));
  if (sigs.length === 0) return { advances: [], truncated: false };

  /* Oldest first, so a draw is seen before the repayment that settles it. */
  const ordered = sigs.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));

  const cache = readCache();
  const byNonce = new Map<number, Advance>();
  const me = wallet.toBase58();
  let truncated = false;

  for (const sig of ordered) {
    let events: CachedEvents;

    const hit = cache[sig.signature];
    if (hit) {
      /* Re-decoding is cheap; the cached form is the raw base64 so the decode
         stays the single source of shape. */
      events = eventsIn(hit as string[]);
    } else {
      const logs = await fetchLogs(sig.signature);
      if (logs === null) {
        /* The RPC refused. Say so at the end rather than quietly dropping an
           advance out of somebody's credit history. */
        truncated = true;
        continue;
      }
      const programData = logs.filter((l) => l.startsWith("Program data: "));
      cache[sig.signature] = programData;
      events = eventsIn(programData);
      /* Small gap between misses; the cached path does not pay it. */
      await nap(120);
    }

    for (const { name, data } of events) {
      const when = sig.blockTime ?? null;

      if (name === "drawn" && data.business?.toBase58?.() === me) {
        const n = Number(data.nonce);
        const a = byNonce.get(n) ?? blank(n);
        a.principal = big(data.principal);
        a.fee = big(data.fee);
        a.totalDue = big(data.totalDue ?? data.total_due);
        a.marginBps = Number(data.marginBps ?? data.margin_bps);
        a.termDays = Number(data.termDays ?? data.term_days);
        /* A token-collateralised draw records the mint where a fee-stream
           draw records the pool. The margin is what tells them apart: only
           the token rail is ever at or above 170%. */
        a.collateral = a.marginBps >= 17_000 ? "token" : "feeStream";
        a.drawnAt = when;
        a.drawTx = sig.signature;
        a.status = "drawn";
        byNonce.set(n, a);
      }

      if (name === "repaid" && data.business?.toBase58?.() === me) {
        const n = Number(data.nonce);
        const a = byNonce.get(n) ?? blank(n);
        a.status = "repaid";
        a.totalDue = big(data.totalDue ?? data.total_due);
        a.coveredByFees = big(data.coveredByFees ?? data.covered_by_fees);
        a.toppedUp = big(data.toppedUp ?? data.topped_up);
        a.wasLate = !!(data.wasLate ?? data.was_late);
        a.settledAt = when;
        a.settleTx = sig.signature;
        byNonce.set(n, a);
      }

      if (name === "liquidated" && data.business?.toBase58?.() === me) {
        /* Liquidation does not carry a nonce, so it settles the newest
           advance still open — which is the only one that can be. */
        const open = [...byNonce.values()].filter((x) => x.status === "drawn");
        const a = open.length > 0 ? open[open.length - 1] : blank(0);
        a.status = "liquidated";
        a.seized = big(data.seized);
        a.settledAt = when;
        a.settleTx = sig.signature;
        byNonce.set(a.nonce, a);
      }
    }
  }

  writeCache(cache);
  return {
    advances: [...byNonce.values()].sort((x, y) => y.nonce - x.nonce),
    truncated,
  };
}
