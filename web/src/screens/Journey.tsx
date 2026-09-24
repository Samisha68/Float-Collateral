/* The borrower's journey, from a cold wallet to a repaid loan.

   One screen rather than a set of tabs, because the stage a business is in is
   not a place it navigates to. It is a fact about its account, derived from
   the chain on every load. A business that has been verified sees the next
   thing it has to do, not a menu of things it cannot do yet. */

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Block, Ledger, Status, Key } from "../components/ui";
import { ConnectButton } from "../wallet";
import { usd, pct, annualised, duration, plural } from "../lib/format";
import { marginBps, rateBps, feeAmount, coverageRequired, nextStep, tierName } from "../lib/pricing";
import { projectFees } from "../lib/chain";
import * as act from "../lib/actions";
import type { Position } from "../lib/useConnected";
import { PublicKey } from "@solana/web3.js";
import Apply from "./steps/Apply";
import Pledge from "./steps/Pledge";

const TERMS = [7, 14, 30, 45, 60];

const STEPS: [string, string][] = [
  ["Connect", "disconnected"],
  ["Get verified", "unverified"],
  ["Pledge a fee stream", "unpledged"],
  ["Draw", "ready"],
  ["Repay", "drawn"],
];

function Progress({ stage }: { stage: string }) {
  const at = STEPS.findIndex(([, s]) => s === stage);
  return (
    <ol className="steps">
      {STEPS.map(([label], i) => (
        <li key={label} data-state={i < at ? "done" : i === at ? "now" : "todo"}>
          <span className="n">{i < at ? "✓" : i + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Journey({
  position, refresh, loading,
}: { position: Position | null; refresh: () => void; loading: boolean }) {
  const { publicKey, sendTransaction } = useWallet();
  const send = (tx: any, conn: any) => sendTransaction(tx, conn);

  if (!publicKey) {
    return (
      <>
        <div className="eyebrow">Float</div>
        <h1 className="tall">Turn the fees your token already earns into working capital.</h1>
        <p className="lede">
          If you launched a token on Meteora, your pool earns you a share of every trade. Float
          lends USDC against that stream and takes the claim on it as security, so the fees repay
          the loan at source. Repay, and your next loan costs less.
        </p>
        <div style={{ marginTop: "2.25rem" }}>
          <ConnectButton lead />
          <p className="note" style={{ marginTop: "0.9rem" }}>
            Devnet. Any Solana wallet. Nothing here moves real money.
          </p>
        </div>
        <Progress stage="disconnected" />
      </>
    );
  }

  if (loading && !position) return <p className="spinner">Reading your account from devnet…</p>;
  if (!position) return <p className="spinner">Reading your account…</p>;

  return (
    <>
      <div className="eyebrow">Your account</div>
      <h1>{position.verification?.verified ? "Float credit" : "Let's get you verified"}</h1>
      <p className="note">
        <Key value={publicKey.toBase58()} />
        {position.verification?.verified && (
          <> · <Status quiet>Verified</Status></>
        )}
      </p>

      <Progress stage={position.stage} />

      {position.stage === "unverified" && <Apply wallet={publicKey} onDone={refresh} />}
      {position.stage === "unpledged" && <Pledge wallet={publicKey} send={send} onDone={refresh} position={position} />}
      {(position.stage === "ready" || position.stage === "drawn") && (
        <Active position={position} send={send} onDone={refresh} />
      )}
    </>
  );
}

/* ── Verified, pledged, and able to transact ─────────────────────────────── */

function Active({
  position, send, onDone,
}: { position: Position; send: act.SendFn; onDone: () => void }) {
  const [amountStr, setAmount] = useState("5,000");
  const [term, setTerm] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);

  useEffect(() => { act.usdcBalance(position.wallet).then(setBalance); }, [position.wallet, done]);

  const n = position.record.advancesRepaid;
  const limit = position.verification?.creditLimit ?? 0n;
  const loan = position.loan;
  const open = position.stage === "drawn" && loan;

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setError(null); setDone(null);
    try {
      const sig = await fn();
      setDone(sig);
      onDone();
    } catch (e: any) {
      setError(e?.error?.errorMessage || e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  if (open && loan) {
    const outstanding = loan.totalDue > loan.collected ? loan.totalDue - loan.collected : 0n;
    const short = balance < outstanding;
    return (
      <>
        <div style={{ marginTop: "2.5rem" }}>
          <div className="headline-figure">{usd(outstanding)}</div>
          <div className="label">
            left to repay, after {usd(loan.collected)} collected from your pool
          </div>
        </div>

        <Block title="This loan">
          <Ledger
            rows={[
              ["Drawn", usd(loan.principal)],
              ["Fee", <>{usd(loan.fee)} <span className="note">· {pct(loan.marginBps ? rateBps(loan.termDays, loan.repaymentsAtDraw) : 0)}</span></>],
              ["Total due", usd(loan.totalDue)],
              ["Collected from fees so far", usd(loan.collected)],
              ["Due", new Date(loan.dueAt * 1000).toLocaleDateString()],
              ["Your USDC balance", usd(balance)],
            ]}
          />
        </Block>

        <div className="actions">
          <button
            className="action"
            disabled={!!busy}
            onClick={() => run("collect", () => act.collectFees(position.wallet, new PublicKey(position.poolAddress!), send))}
          >
            {busy === "collect" ? "Collecting…" : "Collect fees from the pool"}
          </button>
          <button
            className="action primary"
            disabled={!!busy || short}
            onClick={() => run("repay", () => act.repay(position.wallet, send))}
          >
            {busy === "repay" ? "Repaying…" : `Repay ${usd(outstanding)}`}
          </button>
        </div>
        {short && (
          <p className="note">
            You hold {usd(balance)} and need {usd(outstanding)}. Collect the pool's fees first, or
            top up your wallet.
          </p>
        )}
        <Outcome error={error} done={done} />
      </>
    );
  }

  /* Ready to draw. */
  const parsed = Math.max(0, Number(amountStr.replace(/[^0-9.]/g, "")) || 0);
  const draw = BigInt(Math.round(parsed * 1e6));
  const fee = draw > 0n ? feeAmount(draw, term, n) : 0n;
  const coverage = draw > 0n ? coverageRequired(draw, n) : 0n;

  const projected = position.pool && position.pledge && position.observedSecs > 0
    ? projectFees({
        observedGross: (() => {
          const g = position.pool.totalTradingQuoteFee - position.pledge.baselineTradingQuoteFee;
          return g > 0n ? g : 0n;
        })(),
        creatorFeePct: position.pledge.creatorFeePct,
        elapsedSecs: position.observedSecs,
        termDays: term,
        maxExtrapolationRatio: 30,
      })
    : 0n;

  const overLimit = draw > limit;
  const underCovered = coverage > projected;
  const ok = draw > 0n && !overLimit && !underCovered;
  const step = nextStep(n);

  return (
    <>
      <div style={{ marginTop: "2.5rem" }}>
        <div className="headline-figure">{usd(limit)}</div>
        <div className="label">approved credit, at {pct(marginBps(n), 0)} collateral and {pct(rateBps(term, n))} for {term} days</div>
      </div>

      <Block title="Draw">
        <div className="ask">
          <label className="field">
            <span>Amount in USDC</span>
            <input
              type="text" inputMode="decimal" value={amountStr}
              onChange={(e) => setAmount(e.target.value)} aria-label="Amount in USDC"
            />
          </label>
          <label className="field">
            <span>Repay in</span>
            <select value={term} onChange={(e) => setTerm(Number(e.target.value))} aria-label="Term">
              {TERMS.map((t) => <option key={t} value={t}>{t} days</option>)}
            </select>
          </label>
        </div>

        <Ledger
          rows={[
            ["Fee", <>{usd(fee)} <span className="note">· {pct(rateBps(term, n))} · {annualised(rateBps(term, n), term)}</span></>],
            ["Total to repay", usd(draw + fee)],
            ["Coverage required", usd(coverage)],
            ["Fees projected over the term", usd(projected)],
          ]}
        />

        <div className="actions">
          <button
            className="action primary"
            disabled={!ok || !!busy}
            onClick={() => run("borrow", () => act.borrow(position.wallet, new PublicKey(position.poolAddress!), draw, term, send))}
          >
            {busy === "borrow" ? "Drawing…" : `Draw ${usd(draw)}`}
          </button>
        </div>
        {!ok && draw > 0n && (
          <p className="note">
            {overLimit
              ? `That is over your approved limit of ${usd(limit)}.`
              : `Your pool's projected fees of ${usd(projected)} do not cover ${usd(coverage)} at ${pct(marginBps(n), 0)}. Give it more trading, or draw less.`}
          </p>
        )}
        <Outcome error={error} done={done} />
      </Block>

      <Block title="Your standing">
        <Ledger
          rows={[
            ["Tier", <Status quiet>{tierName(n)}</Status>],
            ["Successful repayments", n],
            ["Total repaid", usd(position.record.totalVolumeRepaid)],
            ["Collateral requirement", pct(marginBps(n), 0)],
            ["Next tier", step ? `${plural(step.remaining, "repayment")} away, ${step.marginFrom}% to ${step.marginTo}%` : "Best terms reached"],
          ]}
        />
      </Block>

      <Block title="What secures this">
        <Ledger
          rows={[
            ["Pledged pool", position.poolAddress ? <Key value={position.poolAddress} /> : "—"],
            ["Creator role held by", position.pool ? <Key value={position.pool.creator} /> : "—"],
            ["Creator's share of fees", position.pledge ? `${position.pledge.creatorFeePct}%` : "—"],
            ["Observed by Float for", duration(position.observedSecs)],
            ["Earned under observation", usd(position.observedCreatorFees)],
          ]}
        />
      </Block>
    </>
  );
}

export function Outcome({ error, done }: { error: string | null; done: string | null }) {
  if (error) return <p className="note outcome">Did not go through. {error}</p>;
  if (done)
    return (
      <p className="note outcome">
        Confirmed on devnet. <Key value={done} kind="tx" />
      </p>
    );
  return null;
}
