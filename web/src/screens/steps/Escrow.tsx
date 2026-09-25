/* Escrowing tokens as collateral.

   Two things on this screen are easy to get wrong and expensive to get wrong
   quietly.

   The first is the transfer fee. A Token-2022 mint can charge to move, which
   means the vault receives less than you sent. Float credits what arrived,
   not what you asked to send, so this screen shows both numbers before you
   sign rather than surprising you with a smaller position afterwards.

   The second is the price. Collateral Float has not valued is worth nothing
   to Float, so the check refuses a mint with no posted price instead of
   letting the draw fail later. */

import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Coins, Loader2, Search, CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Rows, KeyLink } from "@/components/ui-kit";
import { Note, Outcome } from "../Journey";
import { usd, pct } from "@/lib/format";
import { collateralCeiling, tokenValueUsdc, marginBpsFor } from "@/lib/pricing";
import * as act from "@/lib/actions";
import { demoCollateral } from "@/lib/api";
import { explainError } from "@/lib/errors";

const amountOf = (raw: bigint, decimals: number) =>
  (Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });

export default function Escrow({
  wallet, repayments, send, onDone, onBack,
}: {
  wallet: PublicKey;
  repayments: number;
  send: act.SendFn;
  onDone: () => void;
  onBack: () => void;
}) {
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<act.MintCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const inspect = async (addr = address) => {
    setChecking(true); setCheck(null); setError(null);
    try { setCheck(await act.checkCollateralMint(addr, wallet)); }
    finally { setChecking(false); }
  };

  const getDemo = async () => {
    setBusy("demo"); setError(null); setDone(null);
    try {
      const t = await demoCollateral(wallet.toBase58());
      setAddress(t.mint);
      await inspect(t.mint);
    } catch (e: any) {
      setError(explainError(e));
    } finally { setBusy(null); }
  };

  const deposit = async () => {
    if (!check?.ok) return;
    setBusy("deposit"); setError(null); setDone(null);
    try {
      setDone(await act.depositTokenCollateral(
        wallet, check.mint, check.tokenProgram, check.balance, send,
      ));
      onDone();
    } catch (e: any) {
      setError(explainError(e));
    } finally { setBusy(null); }
  };

  const value = check?.ok && check.price !== null
    ? tokenValueUsdc(check.balance, check.price, check.decimals)
    : 0n;
  const ceiling = collateralCeiling(value, "token", repayments);

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-title">Escrow your tokens</CardTitle>
          <CardDescription className="text-meta leading-relaxed">
            Float holds them while the loan is open and returns them when it closes. If the
            price falls far enough that they stop covering what you owe, they can be seized to
            settle it — that is the trade for the lower rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="mint" className="text-caption text-muted-foreground">
              Token mint address
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="mint"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setCheck(null); }}
                placeholder="The mint of the token you hold"
                className="h-11 min-w-[18rem] flex-1 font-mono text-meta"
              />
              <Button
                variant="outline"
                className="h-11"
                disabled={!address.trim() || checking}
                onClick={() => inspect()}
              >
                {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" strokeWidth={1.75} />}
                Check
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button variant="outline" disabled={!!busy} onClick={getDemo}>
              {busy === "demo" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" strokeWidth={1.75} />}
              Send me a test token
            </Button>
            <p className="max-w-[46ch] text-caption leading-relaxed text-muted-foreground">
              Float can only value tokens it has posted a price for, and on devnet it publishes
              those itself — there is no oracle here. In practice that means this one. It will
              mint you 500 of a devnet test token and price it, so you can walk the whole rail.
              It is not a real asset and has no value.
            </p>
          </div>

          {check && !check.ok && (
            <Note icon={CircleAlert}>{check.reason}</Note>
          )}

          {check?.ok && (
            <div className="space-y-4">
              <Note icon={CircleCheck}>
                You hold {amountOf(check.balance, check.decimals)} of this token.
                Float values it at {usd(check.price!)} each.
              </Note>
              <Rows
                items={[
                  ["Mint", <KeyLink value={check.mint.toBase58()} />],
                  ["You hold", amountOf(check.balance, check.decimals)],
                  ["Float's posted price", usd(check.price!)],
                  ["Value of your holding", usd(value)],
                  ["Security needed at your tier", pct(marginBpsFor("token", repayments), 0)],
                  ["Most this can support", usd(ceiling)],
                ]}
              />
              <Note>
                A Token-2022 mint can charge a fee to move. If this one does, the vault will
                receive slightly less than you send, and Float will credit what actually
                arrives. The figures above update once it lands.
              </Note>
              <div className="flex flex-wrap gap-2.5">
                <Button disabled={!!busy} onClick={deposit}>
                  {busy === "deposit" ? <Loader2 className="size-4 animate-spin" /> : <Coins className="size-4" strokeWidth={1.75} />}
                  Escrow {amountOf(check.balance, check.decimals)}
                </Button>
                <Button variant="ghost" disabled={!!busy} onClick={onBack}>
                  Use a fee stream instead
                </Button>
              </div>
            </div>
          )}

          {!check && (
            <Button variant="ghost" className="px-0" onClick={onBack}>
              Use a fee stream instead
            </Button>
          )}

          <Outcome error={error} done={done} />
        </CardContent>
      </Card>
    </div>
  );
}
