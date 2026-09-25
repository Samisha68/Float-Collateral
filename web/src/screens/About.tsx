/* What this is, and what it is not.

   A judge forgives a prototype's limits and does not forgive one that hides
   them, so the limits get a card rather than a footnote. */

import {
  ShieldCheck, Link2, Eye, ArrowDownToLine, Coins, RotateCcw, Unlock, Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Rows, KeyLink } from "@/components/ui-kit";
import { SectionHeading } from "@/components/AppShell";
import { config } from "@/lib/chain";

const LOOP: { icon: typeof ShieldCheck; t: string; d: string }[] = [
  { icon: ShieldCheck, t: "Verify", d: "A business is approved and given a credit limit. Its record never moves that number." },
  { icon: Link2, t: "Pledge", d: "The business hands its pool's creator role to Float, in one transaction Meteora enforces." },
  { icon: Eye, t: "Observe", d: "Float watches the pool trade before it will project a fee run rate." },
  { icon: ArrowDownToLine, t: "Draw", d: "USDC out, sized by the projection at the tier the record has earned." },
  { icon: Coins, t: "Collect", d: "Float claims the pool's creator fees straight into its vault." },
  { icon: RotateCcw, t: "Repay", d: "The business covers whatever the stream did not. The record gains one." },
  { icon: Unlock, t: "Release", d: "The creator role goes home." },
];

export default function About() {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h2 className="max-w-[20ch] text-display font-semibold leading-[1.15] tracking-[-0.03em]">
          Credit against revenue that has not arrived yet.
        </h2>
        <p className="max-w-[58ch] text-body leading-relaxed text-muted-foreground">
          A business that launched a token on Meteora earns trading fees as its pool trades. Those
          fees arrive slowly. Payroll does not. Float lends against the stream and takes the claim
          on it as security, so the fees repay the loan at source rather than on a promise.
        </p>
        <p className="max-w-[58ch] text-body leading-relaxed text-muted-foreground">
          Not every business has a pool, so there is a second rail: tokens the business already
          holds, moved into Float's escrow and valued at a posted price. The two are priced
          differently on purpose, and the difference is the argument Float is making.
        </p>
      </div>

      <div>
        <SectionHeading>The loop</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOOP.map(({ icon: Icon, t, d }) => (
            <Card key={t} className="shadow-none">
              <CardContent className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div>
                  <div className="text-body font-medium">{t}</div>
                  <p className="mt-0.5 text-meta leading-relaxed text-muted-foreground">{d}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="size-4.5 text-muted-foreground" strokeWidth={1.75} />
            <CardTitle className="text-lead">Why the pledge is a lock, not a promise</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-body leading-relaxed">
            Float never holds the pool's tokens. It holds the pool's{" "}
            <em className="not-italic font-medium">creator role</em>, which is the authority
            Meteora requires to claim creator trading fees. Once that role has moved, the business
            cannot claim its own pool's fees. Meteora refuses it.
          </p>
          <p className="text-meta leading-relaxed text-muted-foreground">
            That refusal is a test in the repository, not a claim in a deck. The borrower attempts
            the claim on a pledged pool, and the transaction fails.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-lead">One rail needs a price. The other does not.</CardTitle>
          <CardDescription className="text-meta leading-relaxed">
            Float underwrites pools quoted in USDC and nothing else, so on the fee-stream rail the
            income accrues in the same unit as the debt: no price to fetch, no feed to trust, no
            staleness to handle. A SOL-quoted pool would need all three, which is why this version
            declines them.
            <br /><br />
            Escrowed tokens are the opposite. They have to be valued, and the value has to be
            current, so that rail does carry a price feed — one Float itself publishes, with a
            five-minute staleness limit the program enforces on every draw and every seizure. That
            is a real trust assumption and not a small one. A deployment that mattered would read
            Pyth or Switchboard here instead of Float&rsquo;s own key.
          </CardDescription>
        </CardHeader>
      </Card>

      <div>
        <SectionHeading>Two rails, one ladder</SectionHeading>
        <Card className="shadow-none">
          <CardContent className="space-y-4">
            <p className="max-w-[62ch] text-meta leading-relaxed text-muted-foreground">
              Collateral quality sets where a borrower starts. The record is the only thing that
              moves them, and it never moves the approved limit.
            </p>
            <Rows
              items={[
                ["A fee stream", "Collected at source, never seized. 150% falling to 120%"],
                ["Escrowed tokens", "Seizable, but the price moves. 200% falling to 170%"],
                ["What the record changes", "Six repayments, 5 points each, on either rail"],
                ["What the record never changes", "The approved credit limit"],
              ]}
            />
            <p className="max-w-[62ch] text-meta leading-relaxed text-muted-foreground">
              A fee stream cannot be taken, so the record has to do the underwriting. An escrowed
              token can be taken, but only for whatever it is worth on the day — so it posts more
              up front. Neither is the safer asset in the abstract; they fail differently, and the
              margin is where that difference is priced.
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionHeading>What is real, and what stands in</SectionHeading>
        <Card className="shadow-none">
          <CardContent>
            <Rows
              items={[
                ["The program", <>Deployed on devnet <KeyLink value={config.programId} /></>],
                ["Meteora", "The real Dynamic Bonding Curve"],
                ["The pool", <>Real, and one we launched <KeyLink value={config.demoPool} /></>],
                ["USDC", <>A test mint Float controls <KeyLink value={config.usdcMint} /></>],
                ["Verification", "Float's own key, not a compliance provider"],
                ["Token collateral", "Real Token-2022 escrow, including the transfer fee"],
                ["Collateral prices", "Posted by Float's own key. There is no oracle"],
                ["The test collateral token", "Minted on request. Not a real asset, no value"],
                ["The records", "Real. Every repayment is a separate transaction"],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionHeading>Known limits</SectionHeading>
        <Card className="shadow-none">
          <CardContent>
            <Rows
              items={[
                ["Pools must be quoted in USDC", "A SOL-quoted pool would need a price feed"],
                ["The run rate is a forecast", "Capped and observed, but a forecast"],
                ["Prices are relayed, not oracular", "Float posts them. A real deployment needs Pyth or Switchboard"],
                ["One collateral at a time", "A business posts a fee stream or tokens, not both"],
                ["Liquidation has no keeper", "Anyone may seize an uncovered position, but nobody is paid to watch"],
                ["No seizure discount", "A liquidator's margin is whatever the price gap leaves them"],
                ["A fee stream cannot be liquidated", "There is nothing to seize; Float keeps collecting"],
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
