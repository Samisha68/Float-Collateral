/* The business, rather than the transaction it is in the middle of.

   Everything else in this app is about the next thing to do. This page is
   about what Float knows: who was verified, what was approved, what is
   posted as security, and what the record says. A borrower should be able to
   check that without reading a transaction, and a judge should be able to see
   that the KYB evidence is not on chain by looking at what is.

   Two sources, kept visibly apart. The chain half is read from devnet and is
   true for anyone who looks. The application half is read from Float's own
   verifier and is Float's word — the page says which is which, because a
   single merged table would quietly imply the chain had verified a company
   name it has never seen. */

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Building2, Copy, Check, FileLock2, Wallet as WalletIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Headline, Rows, StatusWord, KeyLink } from "@/components/ui-kit";
import { SectionHeading, } from "@/components/AppShell";
import { ConnectButton, useCopy } from "@/wallet";
import { Button } from "@/components/ui/button";
import { usd, pct, shortKey, ago, plural, duration } from "@/lib/format";
import { marginBpsFor, rateBps, nextStep, tierName, tokenValueUsdc, collateralCeiling } from "@/lib/pricing";
import { API } from "@/lib/api";
import { config } from "@/lib/chain";
import type { Position } from "@/lib/useConnected";
import * as act from "@/lib/actions";

type Business =
  | { applied: false }
  | {
      applied: true;
      legalName: string;
      jurisdiction: string;
      companyType: string;
      kybReference: string;
      approvedAt: string;
      signature: string;
    };

const amountOf = (raw: bigint, decimals: number) =>
  (Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });

export default function Profile({
  position, loading,
}: { position: Position | null; loading: boolean }) {
  const { publicKey, wallet } = useWallet();
  const [business, setBusiness] = useState<Business | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const address = publicKey?.toBase58() ?? "";
  const { copy, state: copied } = useCopy(address);

  useEffect(() => {
    if (!publicKey) { setBusiness(null); setBalance(null); return; }
    let live = true;
    API.business(publicKey.toBase58())
      .then((b) => { if (live) setBusiness(b); })
      .catch(() => { if (live) setBusiness({ applied: false }); });
    act.usdcBalance(publicKey)
      .then((b) => { if (live) setBalance(b); })
      .catch(() => { if (live) setBalance(null); });
    return () => { live = false; };
  }, [publicKey?.toBase58()]);

  if (!publicKey)
    return (
      <div className="space-y-5">
        <h2 className="max-w-[22ch] text-display font-semibold leading-[1.12] tracking-[-0.03em]">
          Your profile lives on the chain, not in an account here.
        </h2>
        <p className="max-w-[54ch] text-lead leading-relaxed text-muted-foreground">
          Sign in with your email and Float gives you a wallet, or connect one you already have.
          Either way the wallet is the identity and everything below is read back from devnet —
          Float stores no profile of its own.
        </p>
        <ConnectButton size="lg" />
      </div>
    );

  if (loading && !position)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  /* The chain decides whether a business is verified. Float's own store only
     decides whether there is a name to put on the screen — a wallet seeded by
     script is genuinely approved and has no application on file, and reading
     the eyebrow off the store said "not yet verified" beside a badge reading
     "approved". */
  const verified = !!position?.verification?.verified;
  const n = position?.record.advancesRepaid ?? 0;
  const rail = position?.rail ?? null;
  const limit = position?.verification?.creditLimit ?? 0n;
  const token = position?.token ?? null;
  const step = nextStep(n, rail ?? "feeStream");

  const collateralValue =
    rail === "token" && token?.price
      ? tokenValueUsdc(token.position.amount, token.price.price, token.decimals)
      : 0n;

  return (
    <div className="space-y-8">
      {/* Identity */}
      <Card className="shadow-none">
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="size-4" strokeWidth={1.75} />
                <span className="text-micro uppercase tracking-[0.08em]">
                  {verified ? "Verified business" : "Not yet verified"}
                </span>
              </div>
              <h2 className="text-title font-semibold tracking-tight">
                {business?.applied
                  ? business.legalName
                  : verified
                  ? "Verified on chain"
                  : "No business on file"}
              </h2>
              <p className="text-meta text-muted-foreground">
                {business?.applied
                  ? `${business.companyType} · ${business.jurisdiction}`
                  : verified
                  ? "Approved on devnet. Float's verifier has no application on file for this wallet, so there is no company name to show."
                  : "Apply from this wallet to be approved for credit."}
              </p>
            </div>
            <StatusWord solid={verified}>{verified ? "Approved" : "Unverified"}</StatusWord>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {wallet?.adapter.icon ? (
              <img src={wallet.adapter.icon} alt="" className="size-4 rounded-sm" />
            ) : (
              <WalletIcon className="size-4 text-muted-foreground" strokeWidth={1.75} />
            )}
            <code className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground">
              {address}
            </code>
            <Button variant="outline" size="sm" onClick={copy} className="min-h-9">
              {copied === "done" ? <Check className="size-3.5" strokeWidth={2.25} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
              {copied === "done" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Credit */}
      <div>
        <SectionHeading hint={<StatusWord>{tierName(n)}</StatusWord>}>Your credit</SectionHeading>
        <Card className="shadow-none">
          <CardContent className="space-y-6">
            <Headline
              value={usd(limit)}
              label="approved credit"
              sub="Set at verification. Your record never moves this number."
            />
            <Rows
              items={[
                ["Successful repayments", n],
                ["Overdue", position?.record.advancesOverdue ?? 0],
                ["Advances taken", position?.record.advancesTaken ?? 0],
                ["Total repaid", usd(position?.record.totalVolumeRepaid ?? 0n)],
                [
                  "Security you post",
                  rail
                    ? `${pct(marginBpsFor(rail, n), 0)} on ${rail === "token" ? "escrowed tokens" : "a fee stream"}`
                    : `${pct(marginBpsFor("feeStream", n), 0)} on a fee stream, ${pct(marginBpsFor("token", n), 0)} on tokens`,
                ],
                ["Fee, 30 days", pct(rateBps(30, n))],
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
      </div>

      {/* Security */}
      <div>
        <SectionHeading
          hint={rail && <StatusWord>{rail === "token" ? "Escrowed tokens" : "Fee stream"}</StatusWord>}
        >
          What secures you
        </SectionHeading>
        <Card className="shadow-none">
          <CardContent>
            {rail === "token" && token ? (
              <Rows
                items={[
                  ["Token", <KeyLink value={token.position.mint} />],
                  ["Held in escrow", amountOf(token.position.amount, token.decimals)],
                  ["Float's posted price", token.price ? usd(token.price.price) : "not posted"],
                  ["Value", usd(collateralValue)],
                  ["Most it can carry", usd(collateralCeiling(collateralValue, "token", n))],
                ]}
              />
            ) : rail === "feeStream" && position?.pledge ? (
              <Rows
                items={[
                  ["Pledged pool", position.poolAddress ? <KeyLink value={position.poolAddress} /> : "—"],
                  ["Creator role held by", position.pool ? <KeyLink value={position.pool.creator} /> : "—"],
                  ["Your share of trading fees", `${position.pledge.creatorFeePct}%`],
                  ["Observed for", duration(position.observedSecs)],
                  ["Earned under observation", usd(position.observedCreatorFees)],
                ]}
              />
            ) : (
              <p className="text-meta leading-relaxed text-muted-foreground">
                Nothing posted. You can secure a draw with a Meteora fee stream at{" "}
                {pct(marginBpsFor("feeStream", n), 0)}, or with tokens in escrow at{" "}
                {pct(marginBpsFor("token", n), 0)}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The open loan, if there is one */}
      {position?.loan && position.loan.status === "active" && (
        <div>
          <SectionHeading>Open advance</SectionHeading>
          <Card className="shadow-none">
            <CardContent>
              <Rows
                items={[
                  ["Drawn", usd(position.loan.principal)],
                  ["Fee", usd(position.loan.fee)],
                  ["Total due", usd(position.loan.totalDue)],
                  ["Collected so far", usd(position.loan.collected)],
                  ["Margin at draw", pct(position.loan.marginBps, 0)],
                  ["Term", `${position.loan.termDays} days`],
                  ["Due", new Date(position.loan.dueAt * 1000).toLocaleDateString()],
                  [
                    "Secured by",
                    position.loan.collateralKind === "token" ? "Escrowed tokens" : "A fee stream",
                  ],
                ]}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Wallet */}
      <div>
        <SectionHeading>Your wallet</SectionHeading>
        <Card className="shadow-none">
          <CardContent>
            <Rows
              items={[
                ["Wallet", wallet?.adapter.name ?? "Connected"],
                ["Address", <KeyLink value={address} />],
                ["Network", "Devnet"],
                ["Test USDC balance", balance === null ? "—" : usd(balance)],
                ["Float's program", <KeyLink value={config.programId} />],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* What is on chain, and what is not */}
      <div>
        <SectionHeading>Your KYB evidence</SectionHeading>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lead">
              <FileLock2 className="size-4 text-muted-foreground" strokeWidth={1.75} />
              The documents never touched the chain
            </CardTitle>
            <CardDescription className="text-meta leading-relaxed">
              Float's verifier holds your registration number, your representative's name and your
              filed document off chain. What the chain stores is a single hash of that bundle, so
              anyone can check the evidence has not changed without being able to read it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {business?.applied ? (
              <Rows
                items={[
                  ["Legal name", business.legalName],
                  ["Jurisdiction", business.jurisdiction],
                  ["Company type", business.companyType],
                  ["Approved", new Date(business.approvedAt).toLocaleString()],
                  [
                    "On-chain reference",
                    <span className="font-mono text-caption">{shortKey(business.kybReference)}</span>,
                  ],
                  ["Approval transaction", <KeyLink value={business.signature} kind="tx" />],
                  [
                    "Verified by",
                    position?.verification
                      ? <KeyLink value={position.verification.verifier} />
                      : "—",
                  ],
                  [
                    "Verified",
                    position?.verification
                      ? ago(position.verification.verifiedAt)
                      : "—",
                  ],
                ]}
              />
            ) : (
              <p className="text-meta leading-relaxed text-muted-foreground">
                You have not applied from this wallet yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="max-w-[62ch] text-caption leading-relaxed text-muted-foreground">
        Everything above the KYB card is read from devnet and is true for anyone who looks. The
        KYB card is Float's own record, served by Float's own verifier, and on devnet Float is
        also the verifier — so it is a demonstration of where the data would live, not evidence
        that a compliance provider checked it.
      </p>
    </div>
  );
}
