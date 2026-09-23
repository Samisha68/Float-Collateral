/* "How much working capital do you need?"

   Not "what LTV would you like". The business knows the number it is short;
   Float's job is to work backwards from it and say plainly whether the answer
   is yes, and what it costs. Every figure below is computed the way the
   program computes it, so what this screen promises is what the chain does. */

import { useState } from "react";
import { Figure, Panel, Rows, SectionTitle, Status } from "../components/ui";
import { usd, pct, annualised, duration } from "../lib/format";
import { marginBps, rateBps, feeAmount, coverageRequired } from "../lib/pricing";
import { projectionFor, type BorrowerState } from "../lib/useBorrower";

const TERMS = [7, 14, 30, 45, 60];

export default function Draw({ s }: { s: BorrowerState }) {
  const [amountStr, setAmount] = useState("5000");
  const [term, setTerm] = useState(30);

  const n = s.record.advancesRepaid;
  const limit = s.verification?.creditLimit ?? 0n;
  const active = s.loan && s.loan.status === "active" ? s.loan.principal : 0n;
  const available = limit > active ? limit - active : 0n;

  const parsed = Math.max(0, Number(amountStr.replace(/[^0-9.]/g, "")) || 0);
  const draw = BigInt(Math.round(parsed * 1e6));

  const fee = draw > 0n ? feeAmount(draw, term, n) : 0n;
  const totalDue = draw + fee;
  const coverage = draw > 0n ? coverageRequired(draw, n) : 0n;
  const projected = projectionFor(s, term);

  const overLimit = draw > available;
  const underCovered = coverage > projected;
  const hasPledge = !!s.pledge && !s.pledge.released;
  const observedLongEnough = !s.market || s.observedSecs >= s.market.observationSecs;
  const ok = draw > 0n && !overLimit && !underCovered && hasPledge && observedLongEnough;

  const reasons: string[] = [];
  if (!hasPledge) reasons.push("No fee stream is pledged. A draw has to be secured by one.");
  if (overLimit) reasons.push(`Over the approved limit. ${usd(available)} is available.`);
  if (!observedLongEnough && s.market)
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
      <section>
        <h1>How much working capital do you need?</h1>
      </section>

      <section>
        <div className="grid cols-2">
          <label className="field">
            <span className="label">Amount in USDC</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount in USDC"
            />
          </label>
          <label className="field">
            <span className="label">Repay in</span>
            <select value={term} onChange={(e) => setTerm(Number(e.target.value))} aria-label="Term in days">
              {TERMS.map((t) => (
                <option key={t} value={t}>{t} days</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section>
        <SectionTitle>What Float would offer</SectionTitle>
        <div className="grid cols-2">
          <Panel>
            <Rows
              items={[
                ["Approved credit", usd(limit)],
                ["Available to draw", usd(available)],
                ["Requested draw", usd(draw)],
                ["Collateral tier", pct(marginBps(n), 0)],
                ["Fee", <>{usd(fee)} <span className="note">· {pct(rateBps(term, n))} ({annualised(rateBps(term, n), term)})</span></>],
                ["Total to repay", <strong>{usd(totalDue)}</strong>],
              ]}
            />
          </Panel>
          <Panel>
            <Rows
              items={[
                ["Fee coverage required", usd(coverage)],
                ["Fees projected over the term", usd(projected)],
                ["Already earned, unclaimed", usd(s.pool?.creatorQuoteFee ?? 0n)],
                ["Pool's creator share", s.pledge ? `${s.pledge.creatorFeePct}%` : "—"],
                ["Observation window", s.market ? duration(s.market.observationSecs) : "—"],
                ["Projection cap", s.market ? `${s.market.maxExtrapolationRatio}x the window observed` : "—"],
              ]}
            />
          </Panel>
        </div>
      </section>

      <section>
        <Panel>
          <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <Figure lead value={<Status strong>{ok ? "WOULD BE APPROVED" : "WOULD BE DECLINED"}</Status>} label="Decision at today's terms" />
          </div>
          {!ok && reasons.length > 0 && (
            <ul className="note" style={{ marginTop: 16, paddingLeft: 18 }}>
              {reasons.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
            </ul>
          )}
          {ok && (
            <p className="note" style={{ marginTop: 16 }}>
              The projection is a forecast from observed trading, not a guarantee. If the pool's
              volume falls, the fees may not cover the loan and the business repays the difference.
            </p>
          )}
        </Panel>
      </section>
    </>
  );
}
