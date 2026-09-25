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
  CircleAlert, ArrowUpRight, Loader2, Clock,
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
import {
  marginBpsFor, rateBps, feeAmount, coverageRequired, nextStep, tierName,
  tokenValueUsdc, collateralCeiling, type CollateralKind,
} from "@/lib/pricing";
import { projectFees } from "@/lib/chain";
import * as act from "@/lib/actions";
import type { Position, Stage } from "@/lib/useConnected";
import { explainError } from "@/lib/errors";
import Apply from "./steps/Apply";
import Pledge from "./steps/Pledge";
import Choose from "./steps/Choose";
import Escrow from "./steps/Escrow";

const TERMS = [7, 14, 30, 45, 60];

/** A raw token amount at its mint's decimals. Money uses `usd`; this is for
    the collateral itself, which is not money. */
const amountOf = (raw: bigint, decimals: number) =>
  (Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });

const STEPS: { stage: Stage; label: string; icon: typeof Wallet }[] = [
  { stage: "disconnected", label: "Connect", icon: Wallet },
  { stage: "unverified", label: "Get verified", icon: ShieldCheck },
  { stage: "unsecured", label: "Secure it", icon: Link2 },
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
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption transition-colors",
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
          <h2 className="max-w-[19ch] text-display font-semibold leading-[1.12] tracking-[-0.03em]">
            Working capital against what your business already holds.
          </h2>
          <p className="max-w-[56ch] text-lead leading-relaxed text-muted-foreground">
            Float lends USDC to verified businesses against one of two things: the trading fees
            your Meteora pool already earns, or tokens you hold and escrow. Your approved credit
            is fixed either way. What you put up decides the price — and every advance you repay
            makes the next one cheaper.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <ConnectButton size="lg" />
            <span className="text-caption text-muted-foreground">
              Devnet · any Solana wallet
            </span>
          </div>
        </div>

        <Progress stage="disconnected" />

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, t: "Get verified", d: "A short business check sets your approved credit limit. It does not change after that." },
            { icon: Link2, t: "Choose your security", d: "A Meteora fee stream at 150%, or tokens in escrow at 200%. Different risks, different prices." },
            { icon: ArrowDownToLine, t: "Draw and repay", d: "Draw up to what your collateral supports. Six repayments take 30 points off what you post." },
          ].map(({ icon: Icon, t, d }) => (
            <Card key={t} className="shadow-none">
              <CardContent className="space-y-2">
                <Icon className="size-4.5 text-muted-foreground" strokeWidth={1.75} />
                <div className="text-body font-medium">{t}</div>
                <p className="text-meta leading-relaxed text-muted-foreground">{d}</p>
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
      {position.stage === "unsecured" && (
        <Secure
          wallet={publicKey}
          repayments={position.record.advancesRepaid}
          send={send}
          onDone={refresh}
        />
      )}
      {(position.stage === "ready" || position.stage === "drawn") && (
        <Active position={position} send={send} onDone={refresh} />
      )}
    </div>
  );
}

/* ── Choosing what secures the loan ──────────────────────────────────────────

   A local choice, deliberately. Everything else on this screen is derived
   from the chain, but which rail you are *considering* is not a fact about
   your account until you have actually posted something — so it lives here
   and disappears the moment the chain has an answer. */

function Secure({
  wallet, repayments, send, onDone,
}: {
  wallet: PublicKey;
  repayments: number;
  send: act.SendFn;
  onDone: () => void;
}) {
  const [rail, setRail] = useState<CollateralKind | null>(null);

  if (!rail) return <Choose repayments={repayments} onPick={setRail} />;
  if (rail === "token")
    return (
      <Escrow
        wallet={wallet}
        repayments={repayments}
        send={send}
        onDone={onDone}
        onBack={() => setRail("feeStream")}
      />
    );
  return (
    <div className="space-y-4">
      <Pledge wallet={wallet} send={send} onDone={onDone} />
      <Button variant="ghost" className="px-0" onClick={() => setRail("token")}>
        Escrow tokens instead
      </Button>
    </div>
  );
}

/* ── Verified, secured, transacting ──────────────────────────────────────── */

function Active({
  position, send, onDone,
}: { position: Position; send: act.SendFn; onDone: () => void }) {
  const [amountStr, setAmount] = useState("5000");
  const [term, setTerm] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => { act.usdcBalance(position.wallet).then(setBalance); }, [position.wallet, done]);

  /* Tick only while something is actually waiting on the clock. A timer that
     runs forever on a settled account is a pointless render every second and
     a pointless RPC every minute. */
  const pledgedAt = position.pledge?.pledgedAt ?? 0;
  const windowEndsAt = pledgedAt + (position.market?.observationSecs ?? 0);
  const counting = position.stage === "ready" && pledgedAt > 0 && now < windowEndsAt;

  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => {
      const t = Math.floor(Date.now() / 1000);
      setNow(t);
      /* The moment the window closes, reload the position: the projection is
         computed from fees that accrued while we were waiting. */
      if (t >= windowEndsAt) onDone();
    }, 1000);
    return () => clearInterval(id);
  }, [counting, windowEndsAt, onDone]);

  const n = position.record.advancesRepaid;
  const limit = position.verification?.creditLimit ?? 0n;
  const loan = position.loan;
  const rail: CollateralKind = position.rail ?? "feeStream";
  const step = nextStep(n, rail);
  const token = position.token;

  /* What the escrow is worth right now. Zero on the fee-stream rail, where
     capacity is a projection rather than a valuation. */
  const collateralValue =
    rail === "token" && token?.price
      ? tokenValueUsdc(token.position.amount, token.price.price, token.decimals)
      : 0n;

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setError(null); setDone(null);
    try {
      setDone(await fn());
      onDone();
    } catch (e: any) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  };

  const Standing = (
    <>
      <SectionHeading hint={<StatusWord>{tierName(n)}</StatusWord>}>Your standing</SectionHeading>
      <Card className="shadow-none">
        <CardContent>
          <Rows
            items={[
              ["Successful repayments", n],
              ["Overdue", position.record.advancesOverdue],
              ["Total repaid", usd(position.record.totalVolumeRepaid)],
              ["Collateral requirement", pct(marginBpsFor(rail, n), 0)],
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

      <SectionHeading
        hint={<StatusWord>{rail === "token" ? "Escrowed tokens" : "Fee stream"}</StatusWord>}
      >
        What secures this
      </SectionHeading>
      <Card className="shadow-none">
        <CardContent>
          {rail === "token" && token ? (
            <Rows
              items={[
                ["Token", <KeyLink value={token.position.mint} />],
                ["Held in escrow", amountOf(token.position.amount, token.decimals)],
                ["Float's posted price", token.price ? usd(token.price.price) : "not posted"],
                ["Value of the escrow", usd(collateralValue)],
                [
                  "Price last posted",
                  token.price
                    ? `${duration(Math.max(0, Math.floor(Date.now() / 1000) - token.price.updatedAt))} ago`
                    : "—",
                ],
              ]}
            />
          ) : (
            <Rows
              items={[
                ["Pledged pool", position.poolAddress ? <KeyLink value={position.poolAddress} /> : "—"],
                ["Creator role held by", position.pool ? <KeyLink value={position.pool.creator} /> : "—"],
                ["Your share of trading fees", position.pledge ? `${position.pledge.creatorFeePct}%` : "—"],
                ["Observed by Float for", duration(position.observedSecs)],
                ["Earned under observation", usd(position.observedCreatorFees)],
              ]}
            />
          )}
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
          <CardContent className="space-y-6">
            <Headline
              value={usd(outstanding)}
              label={
                rail === "token"
                  ? "left to repay"
                  : `left to repay, after ${usd(loan.collected)} collected from your pool`
              }
            />
            <Rows
              items={[
                ["Drawn", usd(loan.principal)],
                ["Fee", usd(loan.fee)],
                ["Total due", usd(loan.totalDue)],
                ...(rail === "token"
                  ? ([["Held in escrow", usd(collateralValue)]] as [React.ReactNode, React.ReactNode][])
                  : ([["Collected from fees so far", usd(loan.collected)]] as [React.ReactNode, React.ReactNode][])),
                ["Due", new Date(loan.dueAt * 1000).toLocaleDateString()],
                ["Your USDC balance", usd(balance)],
              ]}
            />
            <div className="flex flex-wrap gap-2.5">
              {rail !== "token" && (
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => run("collect", () => act.collectFees(position.wallet, new PublicKey(position.poolAddress!), send))}
                >
                  {busy === "collect" ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" strokeWidth={1.75} />}
                  Collect fees from pool
                </Button>
              )}
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
                You hold {usd(balance)} and need {usd(outstanding)}.{" "}
                {rail === "token"
                  ? "Top up your wallet to repay and release your collateral."
                  : "Collect the pool's fees first, or top up your wallet."}
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
  const coverage = draw > 0n ? coverageRequired(draw, n, rail) : 0n;
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

  /* The two ceilings, and the one that actually binds.

     This is the answer to the obvious question: can I borrow whatever I ask
     for? No. Your approved limit is what Float is willing to lend you; your
     collateral is what it can support. You get the lower of the two, and a
     borrower should be able to see which one is holding them back without
     submitting a transaction to find out. */
  const capacity =
    rail === "token"
      ? collateralCeiling(collateralValue, "token", n)
      : collateralCeiling(projected, "feeStream", n);
  const ceiling = capacity < limit ? capacity : limit;
  const boundBy = capacity < limit ? "collateral" : "limit";

  /* The observation window.

     The program will not project a run rate from a pool it has barely
     watched, and refuses the draw outright. Nothing on this screen used to
     say so, so a borrower who had just pledged filled in an amount, signed,
     and had ObservationWindowNotElapsed thrown at them — which broke the one
     rule actions.ts opens by stating, that a wallet prompt means the
     transaction is expected to succeed.

     It applies only to the fee-stream rail. Escrowed tokens are valued at a
     posted price, not observed over time, so there is nothing to wait for. */
  const windowSecs = position.market?.observationSecs ?? 0;
  /* Counted from the pledge rather than from the snapshot, so the number on
     screen actually falls. `now` ticks once a second while the wait is on and
     stops as soon as it is over, and the last tick refreshes the position so
     the projection catches up with the trading that happened meanwhile. */
  const observedNow = position.pledge
    ? Math.max(0, now - position.pledge.pledgedAt)
    : position.observedSecs;
  const waitingOnWindow = rail === "feeStream" && observedNow < windowSecs;
  const secsLeft = Math.max(0, windowSecs - observedNow);

  const overLimit = draw > limit;
  const underCovered = coverage > (rail === "token" ? collateralValue : projected);
  const ok = draw > 0n && !overLimit && !underCovered && !waitingOnWindow;

  return (
    <div>
      <Card className="shadow-none">
        <CardContent className="space-y-6">
          {/* During the observation window there is no projection yet, and a
              $0.00 ceiling reads as "your collateral is worth nothing" rather
              than "Float has not finished measuring". Show what is actually
              known — the approved limit — and let the note below explain the
              wait. */}
          <Headline
            value={usd(waitingOnWindow ? limit : ceiling)}
            label={
              waitingOnWindow
                ? "your approved credit, while Float measures your pool"
                : boundBy === "collateral"
                ? "the most your collateral can support"
                : "your approved credit"
            }
            sub={`${pct(marginBpsFor(rail, n), 0)} collateral · ${pct(rateBps(term, n))} for ${term} days`}
          />

          <Rows
            items={[
              ["Approved credit", usd(limit)],
              [
                rail === "token" ? "Escrow value" : "Fees projected over the term",
                waitingOnWindow ? (
                  <span className="font-normal text-muted-foreground">not measured yet</span>
                ) : (
                  usd(rail === "token" ? collateralValue : projected)
                ),
              ],
              [
                "Which your collateral can carry",
                waitingOnWindow ? (
                  <span className="font-normal text-muted-foreground">
                    known once the window closes
                  </span>
                ) : (
                  <>
                    {usd(capacity)}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      at {pct(marginBpsFor(rail, n), 0)}
                    </span>
                  </>
                ),
              ],
              ...(waitingOnWindow
                ? ([] as [React.ReactNode, React.ReactNode][])
                : ([[
                    "So you can draw up to",
                    <>
                      {usd(ceiling)}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {boundBy === "collateral" ? "capped by your collateral" : "capped by your limit"}
                      </span>
                    </>,
                  ]] as [React.ReactNode, React.ReactNode][])),
            ]}
          />

          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <div className="space-y-1.5">
              <label htmlFor="amount" className="text-caption text-muted-foreground">
                How much do you need?
              </label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmount(e.target.value)}
                className="h-12 text-title font-semibold tracking-tight"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-caption text-muted-foreground">Repay in</label>
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
              ["Coverage this draw needs", usd(coverage)],
              [
                rail === "token" ? "Coverage you have escrowed" : "Coverage your fees project",
                waitingOnWindow ? (
                  <span className="font-normal text-muted-foreground">not measured yet</span>
                ) : (
                  usd(rail === "token" ? collateralValue : projected)
                ),
              ],
            ]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={!ok || !!busy}
              onClick={() =>
                run("borrow", () =>
                  rail === "token"
                    ? act.borrowAgainstTokens(
                        position.wallet, new PublicKey(token!.position.mint), draw, term, send,
                      )
                    : act.borrow(
                        position.wallet, new PublicKey(position.poolAddress!), draw, term, send,
                      ),
                )
              }
            >
              {busy === "borrow" ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" strokeWidth={1.75} />}
              Draw {usd(draw)}
            </Button>
          </div>

          {waitingOnWindow && (
            <Note icon={Clock}>
              Float is watching your pool trade before it will lend against it — that is what
              turns a fee history into a run rate it can underwrite.{" "}
              <span className="tabular">{duration(secsLeft)}</span> to go
              {position.observedCreatorFees > 0n && (
                <> · {usd(position.observedCreatorFees)} earned so far</>
              )}
              .
            </Note>
          )}

          {!ok && !waitingOnWindow && draw > 0n && (
            <Note icon={CircleAlert}>
              {overLimit
                ? `That is over your approved limit of ${usd(limit)}.`
                : rail === "token"
                ? ceiling > 0n
                  ? `Your escrow is worth ${usd(collateralValue)} and this draw needs ${usd(coverage)} at ${pct(marginBpsFor(rail, n), 0)}. Escrow more, or draw up to ${usd(ceiling)}.`
                  : `Your escrow is worth ${usd(collateralValue)}, which supports no advance at ${pct(marginBpsFor(rail, n), 0)}. Escrow more before drawing.`
                : ceiling > 0n
                ? `Your pool's projected fees of ${usd(projected)} do not cover ${usd(coverage)} at ${pct(marginBpsFor(rail, n), 0)}. Give it more trading, or draw up to ${usd(ceiling)}.`
                : `Your pool has not earned enough in fees yet to support an advance. It needs more trading volume before Float can lend against it.`}
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
    <div className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-meta leading-relaxed text-muted-foreground">
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
