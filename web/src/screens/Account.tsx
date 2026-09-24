/* A business credit account.

   The first thing a business wants to know is how much credit it has and how
   much of it is spoken for, so that is the first thing on the page and the
   only number allowed to be large. Supply, borrow, LTV and APY are the
   vocabulary of a trading venue and appear nowhere. */

import { Block, Ledger, Spread, Status, Key } from "../components/ui";
import { usd, pct, annualised, ago, duration, plural } from "../lib/format";
import { marginBps, rateBps, nextStep, tierName } from "../lib/pricing";
import type { BorrowerState } from "../lib/useBorrower";

const TERM = 30;

export default function Account({ s }: { s: BorrowerState }) {
  const { verification, record, loan, pool, pledge } = s;
  const limit = verification?.creditLimit ?? 0n;
  const drawn = loan && loan.status === "active" ? loan.principal : 0n;
  const available = limit > drawn ? limit - drawn : 0n;
  const n = record.advancesRepaid;
  const step = nextStep(n);

  return (
    <>
      <div className="eyebrow">Credit account</div>
      <h1>{s.borrower.label}</h1>
      <p className="note">
        <Status quiet>{verification?.verified ? "Verified" : "Not verified"}</Status>
        {verification && <> · approved {ago(verification.verifiedAt)} by <Key value={verification.verifier} /></>}
      </p>

      <div style={{ marginTop: "2.75rem" }}>
        <div className="headline-figure">{usd(available)}</div>
        <div className="label">available to draw today</div>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <Spread
          items={[
            [usd(limit), "Approved credit"],
            [usd(drawn), "Currently drawn"],
            [pct(marginBps(n), 0), "Collateral required"],
            [pct(rateBps(TERM, n)), `Fee, ${TERM} days`],
          ]}
        />
      </div>
      <p className="note" style={{ marginTop: "1.5rem" }}>
        The approved limit was set when this business was verified. Repaying improves the price
        of credit and never raises the limit.
      </p>

      <Block title="Standing">
        <Ledger
          rows={[
            ["Tier", <Status quiet>{tierName(n)}</Status>],
            ["Successful repayments", n],
            ["Overdue", record.advancesOverdue],
            ["Total repaid", usd(record.totalVolumeRepaid)],
            ["Fee annualised", annualised(rateBps(TERM, n), TERM)],
            [
              "Next tier",
              step ? `${plural(step.remaining, "repayment")} away` : "Best terms reached",
            ],
            [
              "Would change",
              step ? `${step.marginFrom}% to ${step.marginTo}% collateral` : "—",
            ],
          ]}
        />
      </Block>

      <Block title="Pledged fee stream">
        {pledge && pool ? (
          <>
            <Ledger
              rows={[
                ["Pool", <Key value={pledge.pool} />],
                ["Creator role held by", <Key value={pool.creator} />],
                ["Creator's share of trading fees", `${pledge.creatorFeePct}%`],
                ["Unclaimed in the pool", usd(pool.creatorQuoteFee)],
                ["Observed by Float for", duration(s.observedSecs)],
                ["Earned under observation", usd(s.observedCreatorFees)],
                ["Status", <Status quiet>{pledge.released ? "Released" : "Pledged to Float"}</Status>],
              ]}
            />
            <p className="note">
              While the pool is pledged, its creator role belongs to Float. This business cannot
              claim these fees. Float collects them against the loan and hands the role back once
              the debt clears.
            </p>
          </>
        ) : (
          <p className="note">
            No fee stream pledged. A draw needs one, because the pledged stream is what secures it.
          </p>
        )}
      </Block>
    </>
  );
}
