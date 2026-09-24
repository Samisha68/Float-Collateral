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
        <h2 className="max-w-[20ch] text-[32px] font-semibold leading-[1.15] tracking-[-0.03em]">
          Credit against revenue that has not arrived yet.
        </h2>
        <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">
          A business that launched a token on Meteora earns trading fees as its pool trades. Those
          fees arrive slowly. Payroll does not. Float lends against the stream and takes the claim
          on it as security, so the fees repay the loan at source rather than on a promise.
        </p>
      </div>

      <div>
        <SectionHeading>The loop</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOOP.map(({ icon: Icon, t, d }) => (
            <Card key={t} className="shadow-none">
              <CardContent className="flex gap-3 pt-6">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div>
                  <div className="text-[14px] font-medium">{t}</div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{d}</p>
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
            <CardTitle className="text-[16px]">Why the pledge is a lock, not a promise</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[14px] leading-relaxed">
            Float never holds the pool's tokens. It holds the pool's{" "}
            <em className="not-italic font-medium">creator role</em>, which is the authority
            Meteora requires to claim creator trading fees. Once that role has moved, the business
            cannot claim its own pool's fees. Meteora refuses it.
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            That refusal is a test in the repository, not a claim in a deck. The borrower attempts
            the claim on a pledged pool, and the transaction fails.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-[16px]">There is no oracle</CardTitle>
          <CardDescription className="text-[13.5px] leading-relaxed">
            Float underwrites pools quoted in USDC and nothing else. The fees accrue in the same
            unit as the debt, so there is no price to fetch, no feed to trust and no staleness to
            handle. A SOL-quoted pool would need all three, which is why this version declines them.
          </CardDescription>
        </CardHeader>
      </Card>

      <div>
        <SectionHeading>What is real, and what stands in</SectionHeading>
        <Card className="shadow-none">
          <CardContent className="pt-6">
            <Rows
              items={[
                ["The program", <>Deployed on devnet <KeyLink value={config.programId} /></>],
                ["Meteora", "The real Dynamic Bonding Curve"],
                ["The pool", <>Real, and one we launched <KeyLink value={config.demoPool} /></>],
                ["USDC", <>A test mint Float controls <KeyLink value={config.usdcMint} /></>],
                ["Verification", "Float's own key, not a compliance provider"],
                ["The records", "Real. Every repayment is a separate transaction"],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionHeading>Known limits</SectionHeading>
        <Card className="shadow-none">
          <CardContent className="pt-6">
            <Rows
              items={[
                ["Pools must be quoted in USDC", "A SOL-quoted pool would need a price feed"],
                ["The run rate is a forecast", "Capped and observed, but a forecast"],
                ["One pool per business", "Multi-collateral is out of scope"],
                ["No liquidation", "Nothing liquid to seize; Float keeps collecting"],
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
