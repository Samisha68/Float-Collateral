/* The screen that carries the argument.

   Two verified businesses, the same approved credit, different histories,
   different terms. Nothing here is a constant: both columns are read from
   BusinessVerification and BusinessRecord accounts on devnet, and borrower B's
   six repayments are six real transactions. If they were hardcoded the claim
   would be a mockup, and a mockup is exactly what this screen exists to not be. */

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Panel, SectionTitle, Status, Key } from "../components/ui";
import { usd, pct, annualised } from "../lib/format";
import { marginBps, rateBps, coverageRequired, tierName } from "../lib/pricing";
import { getRecordsFor } from "../lib/chain";
import { BORROWERS } from "../lib/useBorrower";

const DRAW = 5_000_000_000n; // the same $5,000 ask
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
        const out = BORROWERS.map((b, i) => {
          const { verification: v, record: r } = rows[i];
          return {
            label: b.label, wallet: b.wallet,
            verified: !!v?.verified, limit: v?.creditLimit ?? 0n,
            repaid: r.advancesRepaid, overdue: r.advancesOverdue, volume: r.totalVolumeRepaid,
          };
        });
        if (live) setCols(out);
      } catch (e: any) {
        if (live) setError(e?.message ?? String(e));
      }
    })();
    return () => { live = false; };
  }, []);

  if (error) return <section><p className="note">Could not read devnet: {error}</p></section>;
  if (!cols) return <section><p className="spinner">Reading both records from devnet…</p></section>;

  const [a, b] = cols;
  const cov = (c: Col) => coverageRequired(DRAW, c.repaid);
  const diff = cov(a) > cov(b) ? cov(a) - cov(b) : cov(b) - cov(a);

  const row = (label: string, left: React.ReactNode, right: React.ReactNode, strong = false) => (
    <tr>
      <th scope="row" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 14 }}>
        {label}
      </th>
      <td className="num" style={strong ? { fontWeight: 600 } : undefined}>{left}</td>
      <td className="num" style={strong ? { fontWeight: 600 } : undefined}>{right}</td>
    </tr>
  );

  return (
    <>
      <section>
        <h1>Same credit limit.<br />Different history.<br />Different terms.</h1>
      </section>

      <section>
        <Panel>
          <table>
            <thead>
              <tr>
                <th style={{ width: "40%" }} />
                <th className="num">{a.label}</th>
                <th className="num">{b.label}</th>
              </tr>
            </thead>
            <tbody>
              {row("Status", <Status>{a.verified ? "VERIFIED" : "UNVERIFIED"}</Status>, <Status>{b.verified ? "VERIFIED" : "UNVERIFIED"}</Status>)}
              {row("Tier", <Status>{tierName(a.repaid)}</Status>, <Status>{tierName(b.repaid)}</Status>)}
              {row("Approved credit", usd(a.limit), usd(b.limit), true)}
              {row("Successful repayments", a.repaid, b.repaid)}
              {row("Overdue", a.overdue, b.overdue)}
              {row("Total repaid", usd(a.volume), usd(b.volume))}
              {row("Collateral requirement", pct(marginBps(a.repaid), 0), pct(marginBps(b.repaid), 0), true)}
              {row(
                `Fee (${TERM} days)`,
                `${pct(rateBps(TERM, a.repaid))}`,
                `${pct(rateBps(TERM, b.repaid))}`,
              )}
              {row(
                "Annualised",
                annualised(rateBps(TERM, a.repaid), TERM),
                annualised(rateBps(TERM, b.repaid), TERM),
              )}
            </tbody>
          </table>
        </Panel>
      </section>

      <section>
        <SectionTitle>For the same {usd(DRAW, { cents: false })} draw</SectionTitle>
        <Panel>
          <table>
            <tbody>
              {row("Coverage needed", usd(cov(a)), usd(cov(b)), true)}
            </tbody>
          </table>
          <p style={{ marginTop: 24, fontSize: 17 }}>
            The approved limit is identical. The repayment record is what moved the terms,
            and it moved them by <strong>{usd(diff)}</strong> of coverage.
          </p>
          <p className="note" style={{ marginTop: 8 }}>
            A record improves the price of credit. It never increases how much a business may
            borrow, because the limit lives on an account no credit instruction can write.
          </p>
        </Panel>
      </section>

      <section>
        <SectionTitle>Read it yourself</SectionTitle>
        <Panel quiet>
          <table>
            <tbody>
              {row("Wallet", <Key value={a.wallet} />, <Key value={b.wallet} />)}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 16 }}>
            Both columns are read live from devnet. The {b.repaid} repayments on the right are{" "}
            {b.repaid} separate borrow and repay transactions against this program.
          </p>
        </Panel>
      </section>
    </>
  );
}
