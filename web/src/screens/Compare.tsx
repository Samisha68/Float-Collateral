/* The screen that carries the argument.

   Two verified businesses, the same approved credit, different histories,
   different terms. Both columns are read from BusinessVerification and
   BusinessRecord accounts on devnet, and the six repayments on the right are
   six real transactions. Hardcoded, this would be a mockup, which is the one
   thing it must not be. */

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusWord, KeyLink } from "@/components/ui-kit";
import { SectionHeading } from "@/components/AppShell";
import { Note } from "./Journey";
import { usd, pct, annualised } from "@/lib/format";
import { marginBps, rateBps, coverageRequired, tierName } from "@/lib/pricing";
import { getRecordsFor } from "@/lib/chain";
import { BORROWERS } from "@/lib/useBorrower";

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
            label: b.label, wallet: b.wallet, verified: !!v?.verified,
            limit: v?.creditLimit ?? 0n, repaid: r.advancesRepaid,
            overdue: r.advancesOverdue, volume: r.totalVolumeRepaid,
          };
        }));
      } catch (e: any) { if (live) setError(e?.message ?? String(e)); }
    })();
    return () => { live = false; };
  }, []);

  if (error) return <Note>Could not read devnet. {error}</Note>;
  if (!cols) return <div className="space-y-3"><Skeleton className="h-9 w-72" /><Skeleton className="h-72 w-full" /></div>;

  const [a, b] = cols;
  const cov = (c: Col) => coverageRequired(DRAW, c.repaid);
  const diff = cov(a) > cov(b) ? cov(a) - cov(b) : cov(b) - cov(a);

  const row = (label: string, l: React.ReactNode, r: React.ReactNode, lead = false) => (
    <TableRow>
      <TableCell className="text-meta text-muted-foreground">{label}</TableCell>
      <TableCell className={`tabular text-right text-meta ${lead ? "font-semibold" : ""}`}>{l}</TableCell>
      <TableCell className={`tabular text-right text-meta ${lead ? "font-semibold" : ""}`}>{r}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h2 className="max-w-[18ch] text-display font-semibold leading-[1.15] tracking-[-0.03em]">
          Same credit limit. Different history. Different terms.
        </h2>
        <p className="max-w-[56ch] text-body leading-relaxed text-muted-foreground">
          Two verified businesses, each approved for {usd(a.limit, { cents: false })}. One has
          never borrowed. The other has repaid six times. Float will not lend the second a penny
          more, and it will charge it considerably less.
        </p>
      </div>

      <Card className="shadow-none">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[42%]" />
                <TableHead className="text-right text-micro uppercase tracking-[0.08em]">{a.label}</TableHead>
                <TableHead className="text-right text-micro uppercase tracking-[0.08em]">{b.label}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row("Status", <StatusWord>{a.verified ? "Verified" : "Unverified"}</StatusWord>, <StatusWord>{b.verified ? "Verified" : "Unverified"}</StatusWord>)}
              {row("Tier", <StatusWord>{tierName(a.repaid)}</StatusWord>, <StatusWord>{tierName(b.repaid)}</StatusWord>)}
              {row("Approved credit", usd(a.limit), usd(b.limit), true)}
              {row("Successful repayments", a.repaid, b.repaid)}
              {row("Overdue", a.overdue, b.overdue)}
              {row("Total repaid", usd(a.volume), usd(b.volume))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div>
        <SectionHeading>To draw {usd(DRAW, { cents: false })} for {TERM} days</SectionHeading>
        <Card className="shadow-none">
          <CardContent className="space-y-5">
            <Table>
              <TableBody>
                {row("Collateral requirement", pct(marginBps(a.repaid), 0), pct(marginBps(b.repaid), 0), true)}
                {row("Coverage needed", usd(cov(a)), usd(cov(b)), true)}
                {row("Fee", usd((DRAW * BigInt(rateBps(TERM, a.repaid))) / 10_000n), usd((DRAW * BigInt(rateBps(TERM, b.repaid))) / 10_000n))}
                {row("Rate", pct(rateBps(TERM, a.repaid)), pct(rateBps(TERM, b.repaid)))}
                {row("Annualised", annualised(rateBps(TERM, a.repaid), TERM), annualised(rateBps(TERM, b.repaid), TERM))}
              </TableBody>
            </Table>
            <p className="text-lead leading-relaxed">
              The record moved the terms by <strong className="font-semibold">{usd(diff)}</strong> of
              coverage. It moved the limit by nothing.
            </p>
            <p className="text-meta leading-relaxed text-muted-foreground">
              That is not a convention the code politely observes. The approved limit lives on an
              account only the verifier may write, and the record on an account only the credit
              instructions may write. No credit instruction can reach the limit.
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionHeading>Read it yourself</SectionHeading>
        <Card className="shadow-none">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4 text-meta">
              <span className="text-muted-foreground">{a.label}</span>
              <KeyLink value={a.wallet} />
            </div>
            <div className="flex items-center justify-between gap-4 text-meta">
              <span className="text-muted-foreground">{b.label}</span>
              <KeyLink value={b.wallet} />
            </div>
            <p className="pt-1 text-caption leading-relaxed text-muted-foreground">
              Both columns are read live from devnet. The {b.repaid} repayments on the right are{" "}
              {b.repaid} separate borrow and repay transactions against this program.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
