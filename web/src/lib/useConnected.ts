/* The connected wallet's position with Float, and the stage of the journey
   it is standing in.

   The stage is derived rather than stored. There is no local flag that can
   drift out of step with the chain: if the verification account exists and
   says verified, the business is verified, whatever this app remembered. */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  getFloatAccounts, getPool, findTokenCollateral,
  type Verification, type Record_, type Pledge, type Loan, type PoolView,
  type TokenPosition, type PriceFeed,
} from "./chain";
import type { CollateralKind } from "./pricing";

export type Stage =
  | "disconnected"
  | "unverified"   // connected, no approved credit yet
  | "unsecured"    // verified, but nothing securing a draw
  | "ready"        // something is posted, can draw
  | "drawn";       // a loan is open

export type Market = Awaited<ReturnType<typeof getFloatAccounts>>["market"];

export type TokenCollateral = {
  position: TokenPosition;
  price: PriceFeed | null;
  decimals: number;
};

export type Position = {
  wallet: PublicKey;
  stage: Stage;
  /** Which rail is actually securing this borrower right now. Null until one
      is. Derived from the chain, never from what this app remembered. */
  rail: CollateralKind | null;
  market: Market;
  verification: Verification | null;
  record: Record_;
  pledge: Pledge | null;
  loan: Loan | null;
  pool: PoolView | null;
  poolAddress: string | null;
  observedSecs: number;
  observedCreatorFees: bigint;
  token: TokenCollateral | null;
};

/** A pledge is keyed by pool, so finding a wallet's pledge means asking the
    program for the pools it has pledged rather than guessing an address. */
async function findPledgedPool(wallet: PublicKey): Promise<string | null> {
  const { program } = await import("./chain");
  try {
    const all = await (program.account as any).pledgedPool.all([
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ]);
    const open = all.find((a: any) => !a.account.released);
    return open ? open.account.pool.toBase58() : null;
  } catch {
    return null;
  }
}

export function useConnected() {
  const { publicKey } = useWallet();
  const [position, setPosition] = useState<Position | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!publicKey) { setPosition(null); return; }
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const [poolAddress, token] = await Promise.all([
          findPledgedPool(publicKey),
          findTokenCollateral(publicKey),
        ]);
        const poolKey = poolAddress ? new PublicKey(poolAddress) : null;
        const [accounts, pool] = await Promise.all([
          getFloatAccounts(publicKey, poolKey),
          poolKey ? getPool(poolKey) : Promise.resolve(null),
        ]);
        if (!live) return;

        const { market, verification, record, pledge, loan } = accounts;
        let observedSecs = 0;
        let observedCreatorFees = 0n;
        if (pool && pledge) {
          const gross = pool.totalTradingQuoteFee - pledge.baselineTradingQuoteFee;
          observedCreatorFees = (gross > 0n ? gross : 0n) * BigInt(pledge.creatorFeePct) / 100n;
          observedSecs = Math.max(0, Math.floor(Date.now() / 1000) - pledge.pledgedAt);
        }

        const hasPledge = !!pledge && !pledge.released;
        const hasTokens = !!token && token.position.amount > 0n;

        const stage: Stage =
          !verification?.verified ? "unverified"
          : loan && loan.status === "active" ? "drawn"
          : hasPledge || hasTokens ? "ready"
          : "unsecured";

        /* An open loan knows which rail it came from, so it wins. Otherwise
           whichever collateral is actually posted decides, and a borrower
           holding both is shown the fee stream because it collects itself. */
        const rail: CollateralKind | null =
          loan && loan.status === "active" ? loan.collateralKind
          : hasPledge ? "feeStream"
          : hasTokens ? "token"
          : null;

        setPosition({
          wallet: publicKey, stage, rail, market, verification, record, pledge, loan, pool,
          poolAddress, observedSecs, observedCreatorFees, token,
        });
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [publicKey?.toBase58(), tick]);

  return { position, loading, refresh };
}
