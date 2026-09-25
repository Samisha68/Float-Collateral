/* Pledging a fee stream.

   The one step that gives something up, so it explains itself before asking.
   The pool is checked against every rule the program enforces before the
   wallet is prompted: a signature request that then fails is worse than a
   refusal that explains itself. */

import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Link2, Loader2, Search, CircleAlert, CircleCheck, Radar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyLink } from "@/components/ui-kit";
import { Note, Outcome } from "../Journey";
import * as act from "@/lib/actions";
import { explainError } from "@/lib/errors";

export default function Pledge({
  wallet, send, onDone,
}: { wallet: PublicKey; send: act.SendFn; onDone: () => void }) {
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<act.PoolCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [found, setFound] = useState<act.FoundPool[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const verify = async (addr = address) => {
    setChecking(true); setCheck(null); setError(null);
    try { setCheck(await act.checkPool(addr, wallet)); }
    finally { setChecking(false); }
  };

  /* Ask the chain which pools this wallet owns, rather than asking the
     borrower to remember an address. */
  const scan = async () => {
    setScanning(true); setError(null); setFound(null);
    try {
      const pools = await act.findMyPools(wallet);
      setFound(pools);
      if (pools.length === 1) {
        setAddress(pools[0].address);
        await verify(pools[0].address);
      }
    } catch (e: any) {
      setError(explainError(e));
    } finally { setScanning(false); }
  };

  const pledge = async () => {
    if (!check?.ok) return;
    setBusy(true); setError(null); setDone(null);
    try {
      setDone(await act.pledgePool(wallet, check.pool, check.config, send));
      onDone();
    } catch (e: any) {
      setError(explainError(e));
    } finally { setBusy(false); }
  };

  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Link2 className="size-4.5 text-muted-foreground" strokeWidth={1.75} />
          <CardTitle className="text-lead">Pledge a fee stream</CardTitle>
        </div>
        <CardDescription className="text-meta leading-relaxed">
          Float lends against the trading fees your Meteora pool earns you. To secure a loan you
          hand Float the pool's <strong className="font-medium text-foreground">creator role</strong>,
          the authority Meteora requires to claim those fees.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Note>
          While it is pledged you cannot claim your pool's fees and Float can. Nothing else
          changes: it keeps trading, you keep its tokens, and the role returns to you when the
          loan is repaid.
        </Note>

        <div className="space-y-1.5">
          <label htmlFor="pool-address" className="text-caption text-muted-foreground">
            Your pool address on devnet
          </label>
          <div className="flex gap-2">
            <Input
              id="pool-address"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setCheck(null); }}
              placeholder="3svMNFGD4XC11Lf6K1Mq4aEGS5LjfbU1AYa9BagXAXX4"
              className="font-mono text-caption"
            />
            <Button variant="outline" disabled={!address.trim() || checking} onClick={() => verify()}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" strokeWidth={1.75} />}
              Check
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button variant="outline" disabled={scanning || checking} onClick={scan}>
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" strokeWidth={1.75} />}
            Find my pools
          </Button>
          <p className="max-w-[42ch] text-caption leading-relaxed text-muted-foreground">
            Do not know the address? Meteora records the creator inside the pool, so Float can
            ask devnet which pools this wallet owns.
          </p>
        </div>

        {found?.length === 0 && (
          <Note icon={CircleAlert}>
            This wallet does not own a Meteora bonding-curve pool on devnet. Launch one first, or
            secure your advance with tokens you already hold instead.
          </Note>
        )}

        {found && found.length > 1 && (
          <div className="space-y-2">
            <p className="text-caption text-muted-foreground">
              {found.length} pools found. Pick one.
            </p>
            <div className="space-y-1.5">
              {found.map((f) => (
                <button
                  key={f.address}
                  onClick={() => { setAddress(f.address); void verify(f.address); }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="truncate font-mono text-caption">{f.address}</span>
                  {f.pledged && (
                    <span className="shrink-0 text-micro uppercase tracking-[0.08em] text-muted-foreground">
                      already pledged
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {check && !check.ok && <Note icon={CircleAlert}>{check.reason}</Note>}

        {check?.ok && (
          <>
            <Note icon={CircleCheck}>
              This pool is yours, it trades, it is quoted in USDC, and it pays you{" "}
              {check.creatorFeePct}% of its trading fees. <KeyLink value={check.pool.toBase58()} />
            </Note>
            <Button size="lg" disabled={busy} onClick={pledge}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" strokeWidth={1.75} />}
              Pledge this pool to Float
            </Button>
          </>
        )}

        <Outcome error={error} done={done} />
      </CardContent>
    </Card>
  );
}
