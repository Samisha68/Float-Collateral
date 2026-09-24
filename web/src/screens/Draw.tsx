/* "I need $X."

   The business already knows the number it is short. Asking it to reason
   about collateral ratios first is asking it to do Float's arithmetic. So the
   amount is the first and largest thing on the page, and everything else
   follows from it. Every figure is computed the way the program computes it,
   so what this screen says is what the chain will do. */

import { useState } from "react";
import { Block, Ledger } from "../components/ui";
import { usd, pct, annualised, duration } from "../lib/format";
import { marginBps, rateBps, feeAmount, coverageRequired } from "../lib/pricing";
import { projectionFor, type BorrowerState } from "../lib/useBorrower";

const TERMS = [7, 14, 30, 45, 60];

export default function Draw({ s }: { s: BorrowerState }) {
  const [amountStr, setAmount] = useState("5,000");
  const [term, setTerm] = useState(30);

  const n = s.record.advancesRepaid;
  const limit = s.verification?.creditLimit ?? 0n;
  const active = s.loan && s.loan.status === "active" ? s.loan.principal : 0n;
  const available = limit > active ? limit - active : 0n;

  const parsed = Math.max(0, Number(amountStr.replace(/[^0-9.]/g, "")) || 0);
  const draw = BigInt(Math.round(parsed * 1e6));

  const fee = draw > 0n ? feeAmount(draw, term, n) : 0n;
  const coverage = draw > 0n ? coverageRequired(draw, n) : 0n;
  const projected = projectionFor(s, term);

  const hasPledge = !!s.pledge && !s.pledge.released;
  const observed = !s.market || s.observedSecs >= s.market.observationSecs;
  const overLimit = draw > available;
  const underCovered = coverage > projected;
  const ok = draw > 0n && !overLimit && !underCovered && hasPledge && observed;

  const reasons: string[] = [];
  if (!hasPledge) reasons.push("No fee stream is pledged. A draw has to be secured by one.");
  if (overLimit) reasons.push(`Over the approved limit. ${usd(available)} is available.`);
  if (!observed && s.market)
    reasons.push(
      `Float has watched this pool for ${duration(s.observedSecs)} and needs ${duration(
        s.market.observationSecs,
      )} before it will project a run rate.`,
    );
  if (underCovered)
    reasons.push(
      `Projected fees of ${usd(projected)} do not cover ${usd(coverage)} at ${pct(marginBps(n), 0)}.`,
    );

  return (
    <>
      <div className="eyebrow">Draw</div>
      <h1>How much working capital do you need?</h1>

      <div className="ask" style={{ marginTop: "2.25rem" }}>
        <label className="field">
          <span>Amount in USDC</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount in USDC"
          />
        </label>
        <label className="field">
          <span>Repay in</span>
          <select value={term} onChange={(e) => setTerm(Number(e.target.value))} aria-label="Term">
            {TERMS.map((t) => <option key={t} value={t}>{t} days</option>)}
          </select>
        </label>
      </div>

      <div className="verdict" style={{ marginTop: "2.5rem" }}>
        <div className="word">
          {ok ? "Float would approve this draw." : "Float would decline this draw."}
        </div>
        {!ok && reasons.length > 0 && (
          <ul>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        )}
        {ok && (
          <p className="note" style={{ marginTop: "0.75rem" }}>
            Repay {usd(draw + fee)} in {term} days. The pool's fees pay down whatever they cover;
            you pay the difference.
          </p>
        )}
      </div>

      <Block title="What it costs">
        <Ledger
          rows={[
            ["Requested draw", usd(draw)],
            ["Fee", <>{usd(fee)} <span className="note">· {pct(rateBps(term, n))} · {annualised(rateBps(term, n), term)}</span></>],
            ["Total to repay", usd(draw + fee)],
            ["Approved credit", usd(limit)],
            ["Available to draw", usd(available)],
          ]}
        />
      </Block>

      <Block title="What secures it">
        <Ledger
          rows={[
            ["Collateral tier", pct(marginBps(n), 0)],
            ["Coverage required", usd(coverage)],
            ["Fees projected over the term", usd(projected)],
            ["Already earned, unclaimed", usd(s.pool?.creatorQuoteFee ?? 0n)],
            ["Pool's creator share", s.pledge ? `${s.pledge.creatorFeePct}%` : "—"],
            ["Observation window", s.market ? duration(s.market.observationSecs) : "—"],
            ["Projection capped at", s.market ? `${s.market.maxExtrapolationRatio}x the window observed` : "—"],
          ]}
        />
        <p className="note">
          The projection is a forecast from observed trading, not a guarantee. If the pool's
          volume falls, the fees will not cover the loan and the business repays the difference.
        </p>
      </Block>
    </>
  );
}
