/* Everything on these screens comes from devnet.

   Two sources. Float's own accounts are read through Anchor and the IDL. The
   Meteora pool is read by byte offset, the same offsets the program uses, and
   the same guard: if VirtualPool is not exactly 424 bytes the layout this was
   built against has changed and we say so rather than render a wrong number. */

import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import idl from "./float_credit.json";
import config from "./config.json";

// A public devnet endpoint rate-limits hard enough to break a live demo.
// Point VITE_RPC_URL at a dedicated endpoint before presenting.
export const RPC = (import.meta as any).env?.VITE_RPC_URL || config.rpc;
export const connection = new Connection(RPC, "confirmed");
export const PROGRAM_ID = new PublicKey(config.programId);
export const MARKET_VERSION = Uint8Array.from([2]);
/* The loan PDA is versioned separately from the market. Adding the token rail
   changed Loan's layout, so loans written by the previous program cannot be
   read by this one; a new seed lets both exist rather than misreading bytes. */
export const LOAN_VERSION = Uint8Array.from([2]);
export { config };

const readOnlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async (t: any) => t,
  signAllTransactions: async (t: any) => t,
};

export const provider = new AnchorProvider(connection, readOnlyWallet as any, {
  commitment: "confirmed",
});
export const program = new Program(idl as Idl, provider);

const enc = new TextEncoder();
const pda = (...seeds: (Uint8Array | Buffer)[]) =>
  PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), PROGRAM_ID)[0];

export const marketPda = () => pda(enc.encode("market"), MARKET_VERSION);
export const vaultPda = () => pda(enc.encode("usdc_vault"), MARKET_VERSION);
export const poolAuthorityPda = () => pda(enc.encode("pool_authority"));
export const verificationPda = (w: PublicKey) => pda(enc.encode("verification"), w.toBuffer());
export const recordPda = (w: PublicKey) => pda(enc.encode("record"), w.toBuffer());
export const pledgePda = (pool: PublicKey) => pda(enc.encode("pledge"), pool.toBuffer());
export const loanPda = (w: PublicKey) => pda(enc.encode("loan"), LOAN_VERSION, w.toBuffer());
export const priceFeedPda = (mint: PublicKey) => pda(enc.encode("price"), mint.toBuffer());
export const tokenVaultPda = (mint: PublicKey) => pda(enc.encode("token_vault"), mint.toBuffer());
export const tokenCollateralPda = (w: PublicKey, mint: PublicKey) =>
  pda(enc.encode("token_collateral"), w.toBuffer(), mint.toBuffer());

export type Verification = {
  verified: boolean;
  creditLimit: bigint;
  verifiedAt: number;
  verificationVersion: number;
  verifier: string;
};

export type Record_ = {
  advancesTaken: number;
  advancesRepaid: number;
  advancesOverdue: number;
  totalVolumeRepaid: bigint;
};

export type Pledge = {
  borrower: string;
  pool: string;
  creatorFeePct: number;
  baselineTradingQuoteFee: bigint;
  pledgedAt: number;
  released: boolean;
};

export type PriceFeed = {
  mint: string;
  price: bigint;
  updatedAt: number;
  publisher: string;
};

export type TokenPosition = {
  borrower: string;
  mint: string;
  amount: bigint;
};

export type Loan = {
  collateralKind: "feeStream" | "token";
  collateralRef: string;
  principal: bigint;
  fee: bigint;
  totalDue: bigint;
  collected: bigint;
  marginBps: number;
  termDays: number;
  projectedAtDraw: bigint;
  repaymentsAtDraw: number;
  drawnAt: number;
  dueAt: number;
  nonce: bigint;
  status: "idle" | "active" | "repaid" | "defaulted";
};

const big = (v: any) => BigInt(v.toString());

/* One RPC round trip for every Float account a screen needs.
   Six separate fetches per borrower is six chances to be rate-limited, and
   devnet will take them. getMultipleAccountsInfo asks once. */
async function fetchMany(keys: PublicKey[]): Promise<(Buffer | null)[]> {
  const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
  return infos.map((i) => (i ? (i.data as Buffer) : null));
}

const decode = <T,>(name: string, data: Buffer | null): T | null => {
  if (!data) return null;
  try {
    return program.coder.accounts.decode<T>(name, data);
  } catch {
    return null;
  }
};

export type FloatAccounts = {
  market: Awaited<ReturnType<typeof shapeMarket>> | null;
  verification: Verification | null;
  record: Record_;
  pledge: Pledge | null;
  loan: Loan | null;
};

function shapeMarket(m: any) {
  return {
    admin: m.admin.toBase58(),
    verifier: m.verifier.toBase58(),
    usdcMint: m.usdcMint.toBase58(),
    observationSecs: Number(m.observationSecs),
    maxExtrapolationRatio: Number(m.maxExtrapolationRatio),
    advancesFunded: Number(m.advancesFunded),
    principalOutstanding: big(m.principalOutstanding),
  };
}

function shapeVerification(v: any): Verification {
  return {
    verified: v.verified,
    creditLimit: big(v.creditLimit),
    verifiedAt: Number(v.verifiedAt),
    verificationVersion: Number(v.verificationVersion),
    verifier: v.verifier.toBase58(),
  };
}

function shapeRecord(r: any): Record_ {
  return {
    advancesTaken: Number(r.advancesTaken),
    advancesRepaid: Number(r.advancesRepaid),
    advancesOverdue: Number(r.advancesOverdue),
    totalVolumeRepaid: big(r.totalVolumeRepaid),
  };
}

const EMPTY_RECORD: Record_ = {
  advancesTaken: 0, advancesRepaid: 0, advancesOverdue: 0, totalVolumeRepaid: 0n,
};

function shapePledge(p: any): Pledge {
  return {
    borrower: p.borrower.toBase58(),
    pool: p.pool.toBase58(),
    creatorFeePct: Number(p.creatorFeePct),
    baselineTradingQuoteFee: big(p.baselineTradingQuoteFee),
    pledgedAt: Number(p.pledgedAt),
    released: p.released,
  };
}

function shapeLoan(l: any): Loan {
  return {
    collateralKind: Object.keys(l.collateralKind)[0] as Loan["collateralKind"],
    collateralRef: l.collateralRef.toBase58(),
    principal: big(l.principal),
    fee: big(l.fee),
    totalDue: big(l.totalDue),
    collected: big(l.collected),
    marginBps: Number(l.marginBps),
    termDays: Number(l.termDays),
    projectedAtDraw: big(l.projectedAtDraw),
    repaymentsAtDraw: Number(l.repaymentsAtDraw),
    drawnAt: Number(l.drawnAt),
    dueAt: Number(l.dueAt),
    nonce: big(l.nonce),
    status: Object.keys(l.status)[0] as Loan["status"],
  };
}

function shapePriceFeed(f: any): PriceFeed {
  return {
    mint: f.mint.toBase58(),
    price: big(f.price),
    updatedAt: Number(f.updatedAt),
    publisher: f.publisher.toBase58(),
  };
}

function shapeTokenPosition(t: any): TokenPosition {
  return {
    borrower: t.borrower.toBase58(),
    mint: t.mint.toBase58(),
    amount: big(t.amount),
  };
}

/** A borrower's escrowed token collateral, if they have any.

    A wallet does not know which mints it has posted, so this asks the program
    for the positions it owns rather than guessing a mint. Only one is used
    at a time; a business posting two different tokens is out of scope. */
export async function findTokenCollateral(
  wallet: PublicKey,
): Promise<{ position: TokenPosition; price: PriceFeed | null; decimals: number } | null> {
  let found: any;
  try {
    const all = await (program.account as any).tokenCollateral.all([
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ]);
    found = all.find((a: any) => big(a.account.amount) > 0n) ?? all[0];
  } catch {
    return null;
  }
  if (!found) return null;

  const position = shapeTokenPosition(found.account);
  const mint = new PublicKey(position.mint);
  const [feedData, mintInfo] = await Promise.all([
    fetchMany([priceFeedPda(mint)]).then((d) => d[0]),
    connection.getParsedAccountInfo(mint, "confirmed"),
  ]);
  const feed = decode<any>("priceFeed", feedData);
  const decimals =
    (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 9;
  return { position, price: feed ? shapePriceFeed(feed) : null, decimals };
}

/** Every Float account for one borrower, plus the market, in one request. */
export async function getFloatAccounts(
  wallet: PublicKey,
  pool: PublicKey | null,
): Promise<FloatAccounts> {
  const keys = [marketPda(), verificationPda(wallet), recordPda(wallet), loanPda(wallet)];
  if (pool) keys.push(pledgePda(pool));
  const data = await fetchMany(keys);
  const market = decode<any>("market", data[0]);
  const verification = decode<any>("businessVerification", data[1]);
  const record = decode<any>("businessRecord", data[2]);
  const loan = decode<any>("loan", data[3]);
  const pledge = pool ? decode<any>("pledgedPool", data[4]) : null;
  return {
    market: market ? shapeMarket(market) : null,
    verification: verification ? shapeVerification(verification) : null,
    record: record ? shapeRecord(record) : EMPTY_RECORD,
    pledge: pledge ? shapePledge(pledge) : null,
    loan: loan ? shapeLoan(loan) : null,
  };
}

/** Verification and record for several businesses at once, for the comparison. */
export async function getRecordsFor(
  wallets: PublicKey[],
): Promise<{ verification: Verification | null; record: Record_ }[]> {
  const keys = wallets.flatMap((w) => [verificationPda(w), recordPda(w)]);
  const data = await fetchMany(keys);
  return wallets.map((_, i) => {
    const v = decode<any>("businessVerification", data[i * 2]);
    const r = decode<any>("businessRecord", data[i * 2 + 1]);
    return {
      verification: v ? shapeVerification(v) : null,
      record: r ? shapeRecord(r) : EMPTY_RECORD,
    };
  });
}

/* ── Meteora pool state, by the offsets the program uses ────────────────── */

export const VIRTUAL_POOL_LEN = 424;
const VP = {
  CONFIG: 72, CREATOR: 104, BASE_MINT: 136, BASE_VAULT: 168, QUOTE_VAULT: 200,
  IS_MIGRATED: 305, TOTAL_TRADING_QUOTE_FEE: 336,
  CREATOR_BASE_FEE: 352, CREATOR_QUOTE_FEE: 360, HAS_SWAP: 370,
};

export type PoolView = {
  creator: string;
  config: string;
  isMigrated: boolean;
  hasSwap: boolean;
  totalTradingQuoteFee: bigint;
  creatorQuoteFee: bigint;
};

export async function getPool(pool: PublicKey): Promise<PoolView | null> {
  const info = await connection.getAccountInfo(pool);
  if (!info) return null;
  const d = info.data;
  if (d.length !== VIRTUAL_POOL_LEN) {
    throw new Error(
      `Meteora pool layout changed: expected ${VIRTUAL_POOL_LEN} bytes, found ${d.length}.`,
    );
  }
  const key = (o: number) => new PublicKey(d.subarray(o, o + 32)).toBase58();
  const u64 = (o: number) => d.readBigUInt64LE(o);
  return {
    config: key(VP.CONFIG),
    creator: key(VP.CREATOR),
    isMigrated: d[VP.IS_MIGRATED] !== 0,
    hasSwap: d[VP.HAS_SWAP] !== 0,
    totalTradingQuoteFee: u64(VP.TOTAL_TRADING_QUOTE_FEE),
    creatorQuoteFee: u64(VP.CREATOR_QUOTE_FEE),
  };
}

/** The program's projection, mirrored. Same inputs, same integer steps. */
export function projectFees(args: {
  observedGross: bigint;
  creatorFeePct: number;
  elapsedSecs: number;
  termDays: number;
  maxExtrapolationRatio: number;
}): bigint {
  const { observedGross, creatorFeePct, elapsedSecs, termDays, maxExtrapolationRatio } = args;
  if (elapsedSecs <= 0 || creatorFeePct === 0 || maxExtrapolationRatio === 0) return 0n;
  const creatorShare = (observedGross * BigInt(creatorFeePct)) / 100n;
  const termSecs = BigInt(termDays) * 86_400n;
  const ceiling = BigInt(elapsedSecs) * BigInt(maxExtrapolationRatio);
  const horizon = termSecs < ceiling ? termSecs : ceiling;
  return (creatorShare * horizon) / BigInt(elapsedSecs);
}
