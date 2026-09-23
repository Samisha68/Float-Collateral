/* The home screen: a business credit account, not a DeFi market.

   What a business wants to know first is how much credit it has and how much
   of it is spoken for. Supply, borrow, LTV and APY are the vocabulary of a
   trading venue, and they are not what is being sold here. */

import { Figure, Panel, Rows, SectionTitle, Status, Key } from "../components/ui";
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
      <section>
        <h1>{s.borrower.label}</h1>
        <p className="note" style={{ marginTop: 4 }}>
          <Status strong>{verification?.verified ? "VERIFIED" : "NOT VERIFIED"}</Status>
          {verification && (
            <> &nbsp;·&nbsp; approved {ago(verification.verifiedAt)} by <Key value={verification.verifier} /></>
          )}
        </p>
      </section>

      <section>
        <SectionTitle>Float credit</SectionTitle>
        <div className="grid cols-3">
          <Figure lead value={usd(limit)} label="Approved credit" />
          <Figure value={usd(drawn)} label="Currently drawn" />
          <Figure value={usd(available)} label="Available to draw" />
        </div>
        <p className="note" style={{ marginTop: 16 }}>
          The approved limit is set when a business is verified. Repaying never raises it.
        </p>
      </section>

      <section>
        <SectionTitle>Your terms today</SectionTitle>
        <div className="grid cols-2">
          <Panel>
            <Rows
              items={[
                ["Tier", <Status>{tierName(n)}</Status>],
                ["Successful repayments", n],
                ["Total repaid", usd(record.totalVolumeRepaid)],
                ["Overdue", record.advancesOverdue],
              ]}
            />
          </Panel>
          <Panel>
            <Rows
              items={[
                ["Collateral requirement", pct(marginBps(n), 0)],
                [`Fee (${TERM} days)`, <>{pct(rateBps(TERM, n))} <span className="note">({annualised(rateBps(TERM, n), TERM)})</span></>],
                [
                  "Next tier",
                  step
                    ? `${plural(step.remaining, "repayment")} away`
                    : "Best terms reached",
                ],
                [
                  "What it would change",
                  step ? `${step.marginFrom}% to ${step.marginTo}% collateral` : "—",
                ],
              ]}
            />
          </Panel>
        </div>
      </section>

      <section>
        <SectionTitle>Pledged fee stream</SectionTitle>
        {pledge && pool ? (
          <Panel quiet>
            <Rows
              items={[
                ["Pool", <Key value={pledge.pool} />],
                ["Creator role held by", <Key value={pool.creator} />],
                ["Creator's share of trading fees", `${pledge.creatorFeePct}%`],
                ["Unclaimed fees in the pool", usd(pool.creatorQuoteFee)],
                ["Observed by Float for", duration(s.observedSecs)],
                ["Fees earned under observation", usd(s.observedCreatorFees)],
                ["Status", <Status>{pledge.released ? "RELEASED" : "PLEDGED TO FLOAT"}</Status>],
              ]}
            />
            <p className="note" style={{ marginTop: 16 }}>
              While the pool is pledged, its creator role belongs to Float. The business cannot
              claim these fees; Float collects them against the loan and hands the role back on
              repayment.
            </p>
          </Panel>
        ) : (
          <Panel quiet>
            <p className="note">
              This business has not pledged a fee stream yet. A draw needs one, because the
              pledged stream is what secures it.
            </p>
          </Panel>
        )}
      </section>
    </>
  );
}
