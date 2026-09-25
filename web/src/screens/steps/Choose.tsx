/* What can you offer as security?

   Float asks this before it asks for anything else, because the answer
   decides the terms. A business that launched a token on Meteora has a fee
   stream: income Float can take at source, which cannot be seized but also
   cannot run away. A business that holds tokens has an asset Float can
   escrow: seizable, but worth whatever the market says this afternoon.

   These are different risks, so they get different prices. Saying so on the
   screen where the choice is made is the honest way to price them — the
   alternative is a single number that quietly assumes one kind of borrower. */

import { Link2, Coins, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { marginBpsFor } from "@/lib/pricing";
import { pct } from "@/lib/format";

export type Rail = "feeStream" | "token";

const OPTIONS: {
  rail: Rail;
  icon: typeof Link2;
  title: string;
  who: string;
  how: string;
  why: string;
}[] = [
  {
    rail: "feeStream",
    icon: Link2,
    title: "Fees my token already earns",
    who: "You launched a token on a Meteora bonding curve and the pool pays you a share of every trade.",
    how: "You hand Float the pool's creator role. Meteora enforces it, so the fees arrive at Float and pay the loan down without you doing anything.",
    why: "Float cannot seize a fee stream, so your repayment record does the underwriting. It starts high and falls fast as you repay.",
  },
  {
    rail: "token",
    icon: Coins,
    title: "Tokens I hold",
    who: "You hold a token Float has a price for. No pool, no launch, nothing to build.",
    how: "You move the tokens into Float's escrow. They stay there while the loan is open and come back when it closes.",
    why: "Float can seize these, but their price moves while the loan runs. That risk is priced in up front, which is why this rail starts higher.",
  },
];

export default function Choose({
  repayments, onPick,
}: { repayments: number; onPick: (rail: Rail) => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-title font-semibold tracking-tight">
          What can you put up as security?
        </h2>
        <p className="max-w-[60ch] text-meta leading-relaxed text-muted-foreground">
          Your approved credit is fixed. What you offer as security does not change how much
          you can borrow — it changes what that borrowing costs, and how much you have to put
          up to get it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {OPTIONS.map(({ rail, icon: Icon, title, who, how, why }) => (
          <Card key={rail} className="flex flex-col shadow-none">
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="text-right">
                  <div className="tabular text-stat font-semibold tracking-tight">
                    {pct(marginBpsFor(rail, repayments), 0)}
                  </div>
                  <div className="text-micro uppercase tracking-[0.08em] text-muted-foreground">
                    security needed
                  </div>
                </div>
              </div>

              <div className="text-body font-medium">{title}</div>

              <dl className="flex-1 space-y-3 text-meta leading-relaxed text-muted-foreground">
                <div>
                  <dt className="text-micro uppercase tracking-[0.08em]">Who this is for</dt>
                  <dd className="mt-0.5">{who}</dd>
                </div>
                <div>
                  <dt className="text-micro uppercase tracking-[0.08em]">How it works</dt>
                  <dd className="mt-0.5">{how}</dd>
                </div>
                <div>
                  <dt className="text-micro uppercase tracking-[0.08em]">Why it is priced this way</dt>
                  <dd className="mt-0.5">{why}</dd>
                </div>
              </dl>

              <Button className="w-full" onClick={() => onPick(rail)}>
                {rail === "feeStream" ? "Pledge a pool" : "Escrow tokens"}
                <ArrowRight className="size-4" strokeWidth={1.75} />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="max-w-[62ch] text-caption leading-relaxed text-muted-foreground">
        Both rails walk the same ladder. Every advance you repay takes {pct(500, 0)} off what
        you have to put up, six times over — from {pct(marginBpsFor("feeStream", 0), 0)} to{" "}
        {pct(marginBpsFor("feeStream", 6), 0)} on a fee stream, and from{" "}
        {pct(marginBpsFor("token", 0), 0)} to {pct(marginBpsFor("token", 6), 0)} on escrowed
        tokens. The asset decides where you start. The record is what moves you.
      </p>
    </div>
  );
}
