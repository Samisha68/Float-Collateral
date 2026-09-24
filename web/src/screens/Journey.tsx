/* The borrower's journey, from a cold wallet to a repaid loan.

   One screen rather than a set of tabs, because the stage a business is in is
   not somewhere it navigates to. It is a fact about its account, derived from
   the chain on every load, so a business sees the next thing it has to do
   rather than a menu of things it cannot do yet. */

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  Wallet, ShieldCheck, Link2, ArrowDownToLine, RotateCcw, Check,
  CircleAlert, ArrowUpRight, Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Headline, Rows, StatusWord, KeyLink } from "@/components/ui-kit";
import { SectionHeading } from "@/components/AppShell";
import { ConnectButton } from "@/wallet";
import { cn } from "@/lib/utils";
import { usd, pct, annualised, duration, plural } from "@/lib/format";
import { marginBps, rateBps, feeAmount, coverageRequired, nextStep, tierName } from "@/lib/pricing";
import { projectFees } from "@/lib/chain";
import * as act from "@/lib/actions";
import type { Position, Stage } from "@/lib/useConnected";
import Apply from "./steps/Apply";
import Pledge from "./steps/Pledge";

const TERMS = [7, 14, 30, 45, 60];

const STEPS: { stage: Stage; label: string; icon: typeof Wallet }[] = [
  { stage: "disconnected", label: "Connect", icon: Wallet },
  { stage: "unverified", label: "Get verified", icon: ShieldCheck },
  { stage: "unpledged", label: "Pledge", icon: Link2 },
  { stage: "ready", label: "Draw", icon: ArrowDownToLine },
  { stage: "drawn", label: "Repay", icon: RotateCcw },
];

function Progress({ stage }: { stage: Stage }) {
  const at = STEPS.findIndex((s) => s.stage === stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {STEPS.map(({ label, icon: Icon }, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li key={label} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                now && "border-foreground bg-foreground font-medium text-background",
                done && "border-border text-foreground",
                !now && !done && "border-border/70 text-muted-foreground",
              )}
            >
              {done ? (
                <Check className="size-3.5" strokeWidth={2.25} />
              ) : (
                <Icon className="size-3.5" strokeWidth={1.75} />
              )}
              {label}
            </div>
            {i < STEPS.length - 1 && <span className="w-3 border-t border-border/70" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function Journey({
  position, refresh, loading,
}: { position: Position | null; refresh: () => void; loading: boolean }) {
  const { publicKey, sendTransaction } = useWallet();
  const send = (tx: any, conn: any) => sendTransaction(tx, conn);

  if (!publicKey) {
    return (
      <div className="space-y-8">
        <div className="space-y-5">
          <h2 className="max-w-[17ch] text-[36px] font-semibold leading-[1.12] tracking-[-0.03em]">
            Turn the fees your token already earns into working capital.
          </h2>
          <p className="max-w-[54ch] text-[16px] leading-relaxed text-muted-foreground">
            If you launched a token on Meteora, your pool pays you a share of every trade. Float
            lends USDC against that stream and takes the claim on it as security, so the fees
            repay the loan at source. Repay, and your next loan costs less.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <ConnectButton size="lg" />
            <span className="text-[12.5px] text-muted-foreground">
              Devnet · any Solana wallet
            </span>
          </div>
        </div>

        <Progress stage="disconnected" />

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, t: "Get verified", d: "A short business check sets your approved credit limit." },
            { icon: Link2, t: "Pledge your pool", d: "Hand Float the creator role. Meteora enforces it, not us." },
            { icon: ArrowDownToLine, t: "Draw and repay", d: "Fees pay the loan down. Every repayment improves your terms." },
          ].map(({ icon: Icon, t, d }) => (
            <Card key={t} className="shadow-none">
              <CardContent className="space-y-2 pt-6">
                <Icon className="size-4.5 text-muted-foreground" strokeWidth={1.75} />
                <div className="text-[14px] font-medium">{t}</div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (loading && !position)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (!position) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-8">
      <Progress stage={position.stage} />
      {position.stage === "unverified" && <Apply wallet={publicKey} onDone={refresh} />}
      {position.stage === "unpledged" && <Pledge wallet={publicKey} send={send} onDone={refresh} />}
      {(position.stage === "ready" || position.stage === "drawn") && (
        <Active position={position} send={send} onDone={refresh} />
      )}
    </div>
  );
}

/* ── Verified, pledged, transacting ──────────────────────────────────────── */

function Active({
  position, send, onDone,
}: { position: Position; send: act.SendFn; onDone: () => void }) {
  const [amountStr, setAmount] = useState("5000");
  const [term, setTerm] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);

  useEffect(() => { act.usdcBalance(position.wallet).then(setBalance); }, [position.wallet, done]);

  const n = position.record.advancesRepaid;
  const limit = position.verification?.creditLimit ?? 0n;
  const loan = position.loan;
  const step = nextStep(n);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setError(null); setDone(null);
    try {
      setDone(await fn());
      onDone();
    } catch (e: any) {
      setError(e?.error?.errorMessage || e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const Standing = (
    <>
      <SectionHeading hint={<StatusWord>{tierName(n)}</StatusWord>}>Your standing</SectionHeading>
      <Card className="shadow-none">
        <CardContent className="pt-6">
          <Rows
            items={[
              ["Successful repayments", n],
              ["Overdue", position.record.advancesOverdue],
              ["Total repaid", usd(position.record.totalVolumeRepaid)],
              ["Collateral requirement", pct(marginBps(n), 0)],
              [
                "Next tier",
                step
                  ? `${plural(step.remaining, "repayment")} away · ${step.marginFrom}% to ${step.marginTo}%`
                  : "Best terms reached",
              ],
            ]}
          />
        </CardContent>
      </Card>

      <SectionHeading>What secures this</SectionHeading>
      <Card className="shadow-none">
        <CardContent className="pt-6">
          <Rows
            items={[
              ["Pledged pool", position.poolAddress ? <KeyLink value={position.poolAddress} /> : "—"],
              ["Creator role held by", position.pool ? <KeyLink value={position.pool.creator} /> : "—"],
              ["Your share of trading fees", position.pledge ? `${position.pledge.creatorFeePct}%` : "—"],
              ["Observed by Float for", duration(position.observedSecs)],
              ["Earned under observation", usd(position.observedCreatorFees)],
            ]}
          />
        </CardContent>
      </Card>
    </>
  );

  /* An open loan. */
  if (position.stage === "drawn" && loan) {
    const outstanding = loan.totalDue > loan.collected ? loan.totalDue - loan.collected : 0n;
    const short = balance < outstanding;
    return (
      <div>
        <Card className="shadow-none">
          <CardContent className="space-y-6 pt-6">
            <Headline
              value={usd(outstanding)}
              label={`left to repay, after ${usd(loan.collected)} collected from your pool`}
            />
            <Rows
              items={[
                ["Drawn", usd(loan.principal)],
                ["Fee", usd(loan.fee)],
                ["Total due", usd(loan.totalDue)],
                ["Collected from fees so far", usd(loan.collected)],
                ["Due", new Date(loan.dueAt * 1000).toLocaleDateString()],
                ["Your USDC balance", usd(balance)],
              ]}
            />
            <div className="flex flex-wrap gap-2.5">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => run("collect", () => act.collectFees(position.wallet, new PublicKey(position.poolAddress!), send))}
              >
                {busy === "collect" ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" strokeWidth={1.75} />}
                Collect fees from pool
              </Button>
              <Button
                disabled={!!busy || short}
                onClick={() => run("repay", () => act.repay(position.wallet, send))}
              >
                {busy === "repay" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" strokeWidth={1.75} />}
                Repay {usd(outstanding)}
              </Button>
            </div>
            {short && (
              <Note icon={CircleAlert}>
                You hold {usd(balance)} and need {usd(outstanding)}. Collect the pool's fees
                first, or top up your wallet.
              </Note>
            )}
            <Outcome error={error} done={done} />
          </CardContent>
        </Card>
        {Standing}
      </div>
    );
  }

  /* Ready to draw. */
  const parsed = Math.max(0, Number(amountStr.replace(/[^0-9.]/g, "")) || 0);
  const draw = BigInt(Math.round(parsed * 1e6));
  const fee = draw > 0n ? feeAmount(draw, term, n) : 0n;
  const coverage = draw > 0n ? coverageRequired(draw, n) : 0n;
  const projected =
    position.pool && position.pledge && position.observedSecs > 0
      ? projectFees({
          observedGross: (() => {
            const g = position.pool.totalTradingQuoteFee - position.pledge.baselineTradingQuoteFee;
            return g > 0n ? g : 0n;
          })(),
          creatorFeePct: position.pledge.creatorFeePct,
          elapsedSecs: position.observedSecs,
          termDays: term,
          maxExtrapolationRatio: position.market?.maxExtrapolationRatio ?? 30,
        })
      : 0n;

  const overLimit = draw > limit;
  const underCovered = coverage > projected;
  const ok = draw > 0n && !overLimit && !underCovered;

  return (
    <div>
      <Card className="shadow-none">
        <CardContent className="space-y-6 pt-6">
          <Headline
            value={usd(limit)}
            label="approved credit"
            sub={`${pct(marginBps(n), 0)} collateral · ${pct(rateBps(term, n))} for ${term} days`}
          />

          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <div className="space-y-1.5">
              <label htmlFor="amount" className="text-[12.5px] text-muted-foreground">
                How much do you need?
              </label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 text-[22px] font-semibold tracking-tight md:text-[22px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-muted-foreground">Repay in</label>
              <Select value={String(term)} onValueChange={(v) => setTerm(Number(v))}>
                <SelectTrigger className="h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERMS.map((t) => (
                    <SelectItem key={t} value={String(t)}>{t} days</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Rows
            items={[
              ["Fee", <>{usd(fee)}<span className="ml-1.5 font-normal text-muted-foreground">{pct(rateBps(term, n))} · {annualised(rateBps(term, n), term)}</span></>],
              ["Total to repay", usd(draw + fee)],
              ["Coverage required", usd(coverage)],
              ["Fees projected over the term", usd(projected)],
            ]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={!ok || !!busy}
              onClick={() => run("borrow", () => act.borrow(position.wallet, new PublicKey(position.poolAddress!), draw, term, send))}
            >
              {busy === "borrow" ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" strokeWidth={1.75} />}
              Draw {usd(draw)}
            </Button>
          </div>

          {!ok && draw > 0n && (
            <Note icon={CircleAlert}>
              {overLimit
                ? `That is over your approved limit of ${usd(limit)}.`
                : `Your pool's projected fees of ${usd(projected)} do not cover ${usd(coverage)} at ${pct(marginBps(n), 0)}. Give it more trading, or draw less.`}
            </Note>
          )}
          <Outcome error={error} done={done} />
        </CardContent>
      </Card>
      {Standing}
    </div>
  );
}

export function Note({
  children, icon: Icon = CircleAlert,
}: { children: React.ReactNode; icon?: typeof CircleAlert }) {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </div>
  );
}

export function Outcome({ error, done }: { error: string | null; done: string | null }) {
  if (error) return <Note icon={CircleAlert}>Did not go through. {error}</Note>;
  if (done)
    return (
      <Note icon={ArrowUpRight}>
        Confirmed on devnet. <KeyLink value={done} kind="tx" />
      </Note>
    );
  return null;
}
