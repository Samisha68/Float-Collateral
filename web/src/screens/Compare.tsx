/* The screen that carries the argument.

   One claim, stated once, then the evidence for it. Both columns are read
   from BusinessVerification and BusinessRecord accounts on devnet, and the
   six repayments on the right are six real transactions. If they were
   hardcoded this would be a mockup, which is the one thing it must not be. */

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Block, Ledger, Status, Key } from "../components/ui";
import { usd, pct, annualised } from "../lib/format";
import { marginBps, rateBps, coverageRequired, tierName } from "../lib/pricing";
import { getRecordsFor } from "../lib/chain";
import { BORROWERS } from "../lib/useBorrower";

const DRAW = 5_000_000_000n;
const TERM = 30;

type Col = {
  label: string; wallet: string; verified: boolean;
  limit: bigint; repaid: number; overdue: number; volume: bigint;
};

export default function Compare() {
  const [cols, setCols] = useState<Col[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = await getRecordsFor(BORROWERS.map((b) => new PublicKey(b.wallet)));
        if (!live) return;
        setCols(BORROWERS.map((b, i) => {
          const { verification: v, record: r } = rows[i];
          return {
            label: b.label, wallet: b.wallet,
            verified: !!v?.verified, limit: v?.creditLimit ?? 0n,
            repaid: r.advancesRepaid, overdue: r.advancesOverdue, volume: r.totalVolumeRepaid,
          };
        }));
      } catch (e: any) {
        if (live) setError(e?.message ?? String(e));
      }
    })();
    return () => { live = false; };
  }, []);

  if (error) return <p className="note">Could not read devnet. {error}</p>;
  if (!cols) return <p className="spinner">Reading both records from devnet…</p>;

  const [a, b] = cols;
  const cov = (c: Col) => coverageRequired(DRAW, c.repaid);
  const diff = cov(a) > cov(b) ? cov(a) - cov(b) : cov(b) - cov(a);

  const pair = (label: string, l: React.ReactNode, r: React.ReactNode, lead = false) => (
    <tr>
      <th scope="row">{label}</th>
      <td className={lead ? "lead" : undefined}>{l}</td>
      <td className={lead ? "lead" : undefined}>{r}</td>
    </tr>
  );

  return (
    <>
      <div className="eyebrow">The argument</div>
      <h1 className="tall">Same credit limit. Different history. Different terms.</h1>
      <p className="lede">
        Two verified businesses, each approved for {usd(a.limit, { cents: false })}. One has
        never borrowed. The other has repaid six times. Float will not lend the second one a
        penny more, and it will charge it considerably less.
      </p>

      <Block title="Both businesses">
        <table className="ledger wide">
          <thead>
            <tr>
              <th />
              <th className="num">{a.label}</th>
              <th className="num">{b.label}</th>
            </tr>
          </thead>
          <tbody>
            {pair("Status", <Status quiet>{a.verified ? "Verified" : "Unverified"}</Status>,
                            <Status quiet>{b.verified ? "Verified" : "Unverified"}</Status>)}
            {pair("Tier", <Status quiet>{tierName(a.repaid)}</Status>,
                          <Status quiet>{tierName(b.repaid)}</Status>)}
            {pair("Approved credit", usd(a.limit), usd(b.limit), true)}
            {pair("Successful repayments", a.repaid, b.repaid)}
            {pair("Overdue", a.overdue, b.overdue)}
            {pair("Total repaid", usd(a.volume), usd(b.volume))}
          </tbody>
        </table>
      </Block>

      <Block title={`To draw ${usd(DRAW, { cents: false })} for ${TERM} days`}>
        <table className="ledger wide">
          <tbody>
            {pair("Collateral requirement", pct(marginBps(a.repaid), 0), pct(marginBps(b.repaid), 0), true)}
            {pair("Coverage needed", usd(cov(a)), usd(cov(b)), true)}
            {pair("Fee", usd((DRAW * BigInt(rateBps(TERM, a.repaid))) / 10_000n),
                         usd((DRAW * BigInt(rateBps(TERM, b.repaid))) / 10_000n))}
            {pair("Rate", pct(rateBps(TERM, a.repaid)), pct(rateBps(TERM, b.repaid)))}
            {pair("Annualised", annualised(rateBps(TERM, a.repaid), TERM),
                                annualised(rateBps(TERM, b.repaid), TERM))}
          </tbody>
        </table>

        <p className="lede" style={{ marginTop: "2rem" }}>
          The record moved the terms by {usd(diff)} of coverage. It moved the limit by nothing.
        </p>
        <p className="note">
          That is not a convention the code politely observes. The approved limit lives on an
          account only the verifier may write, and the record lives on an account only the credit
          instructions may write. No credit instruction can reach the limit.
        </p>
      </Block>

      <Block title="Read it yourself">
        <Ledger
          rows={[
            [a.label, <Key value={a.wallet} />],
            [b.label, <Key value={b.wallet} />],
          ]}
        />
        <p className="note">
          Both columns are read live from devnet. The {b.repaid} repayments on the right are{" "}
          {b.repaid} separate borrow and repay transactions against this program.
        </p>
      </Block>
    </>
  );
}
