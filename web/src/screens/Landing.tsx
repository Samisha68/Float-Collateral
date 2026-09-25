/* The front door.

   Short on purpose. The earlier version explained the product the way the
   About page does, which meant a visitor had to read four paragraphs before
   reaching anything they could act on — and a landing page competing with its
   own documentation loses to it.

   What a stranger needs is one claim, evidence it is real, the one idea that
   makes Float different from every other lender, and a way in. Everything
   else already has a page. */

import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/wallet";
import { usd, pct, explorer } from "@/lib/format";
import { marginBpsFor, rateBps } from "@/lib/pricing";
import { useNetwork } from "@/lib/useNetwork";
import { config } from "@/lib/chain";
import type { Tab } from "@/components/AppShell";

export default function Landing({ go }: { go: (tab: Tab) => void }) {
  const stats = useNetwork();

  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 pb-24 pt-16 sm:px-6 lg:pt-24">
      {/* The claim, and the evidence for it */}
      <section className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
        <div className="space-y-6">
          <h1 className="max-w-[15ch] text-display font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[2.75rem]">
            Borrow against what your business already holds.
          </h1>
          <p className="max-w-[46ch] text-lead leading-relaxed text-muted-foreground">
            USDC today, against your token's trading fees or tokens you escrow.
            Every repayment makes the next advance cheaper.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <ConnectButton size="lg" />
            <span className="text-caption text-muted-foreground">Devnet</span>
          </div>
        </div>

        {stats && stats.advancesFunded > 0 && (
          <Card className="shadow-none">
            <CardContent className="space-y-5">
              <p className="text-micro uppercase tracking-[0.1em] text-muted-foreground">
                Live on devnet
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-6">
                {[
                  [String(stats.advancesFunded), "advances funded"],
                  [String(stats.repaidCount), "repaid in full"],
                  [usd(stats.totalRepaid, { cents: false }), "returned"],
                  [pct(marginBpsFor("feeStream", 6), 0), "best rate earned"],
                ].map(([v, l]) => (
                  <div key={l}>
                    <div className="tabular text-title font-semibold tracking-tight">{v}</div>
                    <div className="mt-0.5 text-caption text-muted-foreground">{l}</div>
                  </div>
                ))}
              </div>
              <a
                href={explorer(config.programId)}
                target="_blank"
                rel="noreferrer"
                className="block border-t pt-4 text-caption text-muted-foreground underline decoration-border underline-offset-[3px] hover:decoration-foreground"
              >
                Read from the program. Check it yourself.
              </a>
            </CardContent>
          </Card>
        )}
      </section>

      {/* The one idea */}
      <section className="space-y-5">
        <h2 className="max-w-[26ch] text-title font-semibold tracking-tight">
          Your record changes the price. Never the limit.
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-meta">
            <thead>
              <tr className="border-b text-micro uppercase tracking-[0.08em] text-muted-foreground">
                <th className="pb-2 text-left font-medium">$5,000 for 30 days</th>
                <th className="pb-2 text-right font-medium">Day one</th>
                <th className="pb-2 text-right font-medium">After six repayments</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Approved credit", "$10,000", "$10,000"],
                ["You post", pct(marginBpsFor("feeStream", 0), 0), pct(marginBpsFor("feeStream", 6), 0)],
                ["Locked up", "$7,500", "$6,000"],
                ["Fee", usd((5_000_000_000n * BigInt(rateBps(30, 0))) / 10_000n),
                        usd((5_000_000_000n * BigInt(rateBps(30, 6))) / 10_000n)],
              ].map(([label, a, b], i) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="py-2.5 text-muted-foreground">{label}</td>
                  <td className="py-2.5 text-right tabular">{a}</td>
                  <td className={`py-2.5 text-right tabular ${i > 0 ? "font-medium" : ""}`}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button variant="outline" onClick={() => go("compare")}>
          Two real businesses, side by side
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </Button>
      </section>

      {/* The two rails, in a line each */}
      <section className="grid gap-4 sm:grid-cols-2">
        {[
          {
            t: "A Meteora fee stream",
            d: "Float collects your pool's fees at source, so the advance repays itself.",
            m: marginBpsFor("feeStream", 0), f: marginBpsFor("feeStream", 6),
          },
          {
            t: "Tokens in escrow",
            d: "No pool needed. Float holds them until the advance closes.",
            m: marginBpsFor("token", 0), f: marginBpsFor("token", 6),
          },
        ].map(({ t, d, m, f }) => (
          <Card key={t} className="shadow-none">
            <CardContent className="space-y-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-body font-medium">{t}</span>
                <span className="tabular shrink-0 text-meta text-muted-foreground">
                  {pct(m, 0)} → {pct(f, 0)}
                </span>
              </div>
              <p className="text-meta leading-relaxed text-muted-foreground">{d}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* What it is not */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-t pt-8">
        <p className="max-w-[54ch] text-meta leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Devnet only.</span> The program, the
          Meteora pools and every repayment are real. The USDC is a test mint, and Float verifies
          businesses with its own key rather than a KYB provider.
        </p>
        <Button variant="ghost" className="px-0" onClick={() => go("about")}>
          What Float will not pretend
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </Button>
      </section>
    </div>
  );
}
