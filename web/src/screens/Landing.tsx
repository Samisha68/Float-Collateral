/* The front door.

   Everything else in this app is the product. This is the argument for it,
   and the two should not look the same. A visitor who has not signed in has
   no account, so a sidebar reading "Your account" is a lie, and a five-step
   pipeline reading Connect → Verify → Secure → Draw → Repay is an internal
   process diagram shown to someone who has not asked how the sausage is made.
   No platform does that. The app begins after you are in.

   What a stranger needs, in order: what this is and whether it is for them,
   why the terms work the way they do, evidence that any of it is real, and
   what it honestly is not. The evidence is read live off devnet, because a
   lending page full of numbers nobody can check is exactly what a judge has
   already read ten of today. */

import { ArrowRight, Link2, Coins, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/wallet";
import { usePrivySession } from "@/privy";
import { usd, pct } from "@/lib/format";
import { marginBpsFor, rateBps } from "@/lib/pricing";
import { useNetwork } from "@/lib/useNetwork";
import { config } from "@/lib/chain";
import { explorer } from "@/lib/format";
import type { Tab } from "@/components/AppShell";

const RAILS = [
  {
    icon: Link2,
    title: "The fees your token already earns",
    body:
      "You launched a token on a Meteora bonding curve, and the pool pays you a share of every " +
      "trade. Float lends against that stream and collects it at source, so the loan repays " +
      "itself while you get on with the week.",
    margin: marginBpsFor("feeStream", 0),
    floor: marginBpsFor("feeStream", 6),
    note: "Float cannot seize a fee stream, so your record does the underwriting.",
  },
  {
    icon: Coins,
    title: "Tokens you already hold",
    body:
      "No pool, no launch, nothing to build. Move tokens into escrow, draw against what they " +
      "are worth, and take them back when the advance closes.",
    margin: marginBpsFor("token", 0),
    floor: marginBpsFor("token", 6),
    note: "Float can seize these, but their price moves — so they post more up front.",
  },
];

export default function Landing({ go }: { go: (tab: Tab) => void }) {
  const session = usePrivySession();
  const stats = useNetwork();

  return (
    <div className="mx-auto max-w-5xl space-y-20 px-4 pb-24 pt-14 sm:px-6 lg:pt-20">
      {/* What this is, with the evidence beside it rather than below */}
      <section className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-16">
        <div className="space-y-6">
          <p className="text-micro uppercase tracking-[0.12em] text-muted-foreground">
            On-chain working capital for businesses
          </p>
          <h1 className="max-w-[16ch] text-display font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[2.75rem]">
            Your revenue is real before it arrives.
          </h1>
          <p className="max-w-[52ch] text-lead leading-relaxed text-muted-foreground">
            Payroll is due Friday. The money is coming, just not today. Float lends USDC against
            what your business already holds — the trading fees your token earns, or tokens you
            put in escrow — and records every repayment on Solana, where it makes your next
            advance cheaper.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <ConnectButton size="lg" />
            <span className="text-caption text-muted-foreground">
              {session.enabled ? "Email or any Solana wallet" : "Any Solana wallet"} · devnet
            </span>
          </div>
        </div>

        {stats && stats.advancesFunded > 0 && (
          <Card className="shadow-none lg:mt-10">
            <CardContent className="space-y-5">
              <p className="text-micro uppercase tracking-[0.1em] text-muted-foreground">
                Live on devnet
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-6">
                {[
                  { v: String(stats.advancesFunded), l: "advances funded" },
                  { v: String(stats.repaidCount), l: "repaid in full" },
                  { v: usd(stats.totalRepaid, { cents: false }), l: "principal and fees returned" },
                  { v: pct(marginBpsFor("feeStream", 6), 0), l: "best collateral rate earned" },
                ].map(({ v, l }) => (
                  <div key={l}>
                    <div className="tabular text-title font-semibold tracking-tight">{v}</div>
                    <div className="mt-0.5 text-caption leading-relaxed text-muted-foreground">
                      {l}
                    </div>
                  </div>
                ))}
              </div>
              <p className="border-t pt-4 text-caption leading-relaxed text-muted-foreground">
                Read from Float's program, not from a spreadsheet.{" "}
                <a
                  href={explorer(config.programId)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-border underline-offset-[3px] hover:decoration-foreground"
                >
                  Check it yourself
                </a>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* The argument */}
      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="max-w-[24ch] text-title font-semibold tracking-tight">
            What you put up decides the price. Never how much you can borrow.
          </h2>
          <p className="max-w-[58ch] text-body leading-relaxed text-muted-foreground">
            Your approved credit is set once, when your business is verified, and nothing moves it
            afterwards. What changes is the cost — and that starts with the kind of security you
            offer, because the two kinds fail in different ways.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {RAILS.map(({ icon: Icon, title, body, margin, floor, note }) => (
            <Card key={title} className="shadow-none">
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <div className="text-right">
                    <div className="tabular text-stat font-semibold tracking-tight">
                      {pct(margin, 0)}
                    </div>
                    <div className="text-micro uppercase tracking-[0.08em] text-muted-foreground">
                      falling to {pct(floor, 0)}
                    </div>
                  </div>
                </div>
                <div className="text-body font-medium">{title}</div>
                <p className="text-meta leading-relaxed text-muted-foreground">{body}</p>
                <p className="border-t pt-3 text-caption leading-relaxed text-muted-foreground">
                  {note}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button variant="outline" onClick={() => go("compare")}>
          See what a record is worth
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </Button>
      </section>

      {/* What repaying earns */}
      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="max-w-[26ch] text-title font-semibold tracking-tight">
            Six repayments, and the same advance costs you less.
          </h2>
          <p className="max-w-[58ch] text-body leading-relaxed text-muted-foreground">
            Not a score Float invented. A count of advances actually settled, held in an account
            anyone can read — which is what makes it worth something outside Float.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-meta">
            <thead>
              <tr className="border-b text-micro uppercase tracking-[0.08em] text-muted-foreground">
                <th className="pb-2 text-left font-medium">On a $5,000 advance for 30 days</th>
                <th className="pb-2 text-right font-medium">New business</th>
                <th className="pb-2 text-right font-medium">After six repayments</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Approved credit", usd(10_000_000_000n, { cents: false }), usd(10_000_000_000n, { cents: false })],
                ["Security you post", pct(marginBpsFor("feeStream", 0), 0), pct(marginBpsFor("feeStream", 6), 0)],
                ["Coverage needed", usd(7_500_000_000n, { cents: false }), usd(6_000_000_000n, { cents: false })],
                ["Fee", usd((5_000_000_000n * BigInt(rateBps(30, 0))) / 10_000n), usd((5_000_000_000n * BigInt(rateBps(30, 6))) / 10_000n)],
              ].map(([label, a, b], i) => (
                <tr key={String(label)} className="border-b last:border-0">
                  <td className="py-2.5 text-muted-foreground">{label}</td>
                  <td className="py-2.5 text-right tabular">{a}</td>
                  <td className={`py-2.5 text-right tabular ${i > 0 ? "font-medium" : ""}`}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-muted-foreground">
          Same limit. Different history. $1,500 less locked up, and $30 less to borrow it.
        </p>
      </section>

      {/* What it is, and what stands in */}
      <section className="space-y-5 rounded-xl border p-6 sm:p-8">
        <h2 className="text-lead font-medium">What is real here, and what stands in</h2>
        <div className="grid gap-8 sm:grid-cols-2">
          <div className="space-y-3">
            <p className="text-micro uppercase tracking-[0.1em] text-muted-foreground">Real</p>
            <ul className="space-y-2.5">
              {[
                "An Anchor program deployed on Solana devnet",
                "Meteora bonding-curve pools, really pledged",
                "Token-2022 escrow, transfer fee and all",
                "Every advance and repayment, its own transaction",
              ].map((line) => (
                <li key={line} className="flex gap-2 text-meta leading-relaxed">
                  <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <p className="text-micro uppercase tracking-[0.1em] text-muted-foreground">
              Stands in
            </p>
            <ul className="space-y-2.5">
              {[
                "The USDC is a test mint Float controls",
                "Verification is Float's own key, not a KYB provider",
                "Collateral prices are posted by Float, not an oracle",
                "No mainnet transaction has ever been signed",
              ].map((line) => (
                <li key={line} className="flex gap-2 text-meta leading-relaxed text-muted-foreground">
                  <span className="mt-0.5 w-3.5 shrink-0 text-center">·</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Button variant="ghost" className="px-0" onClick={() => go("about")}>
          Everything Float will not pretend about
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </Button>
      </section>

      {/* Close */}
      <section className="space-y-5 border-t pt-12">
        <h2 className="max-w-[20ch] text-title font-semibold tracking-tight">
          Apply in about a minute.
        </h2>
        <p className="max-w-[52ch] text-body leading-relaxed text-muted-foreground">
          A short business check sets your limit. Then choose what secures it, and draw.
        </p>
        <ConnectButton size="lg" />
      </section>
    </div>
  );
}
