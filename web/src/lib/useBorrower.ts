/* One borrower's whole position, loaded from devnet in a single pass. */

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  config, getFloatAccounts, getPool, projectFees,
  type Verification, type Record_, type Pledge, type Loan, type PoolView,
} from "./chain";

export type Borrower = {
  key: "A" | "B";
  label: string;
  wallet: string;
  poolAddress: string | null;
};

export const BORROWERS: Borrower[] = [
  { key: "A", label: config.borrowerA.label, wallet: config.borrowerA.wallet, poolAddress: config.borrowerA.pool },
  { key: "B", label: config.borrowerB.label, wallet: config.borrowerB.wallet, poolAddress: config.borrowerB.pool },
];

export type Market = Awaited<ReturnType<typeof getFloatAccounts>>["market"];

export type BorrowerState = {
  borrower: Borrower;
  market: Market;
  verification: Verification | null;
  record: Record_;
  pledge: Pledge | null;
  loan: Loan | null;
  pool: PoolView | null;
  /** Fees Float has observed accruing since the pledge, creator's share. */
  observedCreatorFees: bigint;
  observedSecs: number;
};

export function useBorrower(borrower: Borrower) {
  const [state, setState] = useState<BorrowerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setState(null);
    setError(null);
    (async () => {
      try {
        const wallet = new PublicKey(borrower.wallet);
        const poolKey = borrower.poolAddress ? new PublicKey(borrower.poolAddress) : null;
        const [accounts, pool] = await Promise.all([
          getFloatAccounts(wallet, poolKey),
          poolKey ? getPool(poolKey) : Promise.resolve(null),
        ]);
        if (!live) return;
        const { market, verification, record, loan, pledge } = accounts;

        let observedCreatorFees = 0n;
        let observedSecs = 0;
        if (pool && pledge) {
          const gross = pool.totalTradingQuoteFee - pledge.baselineTradingQuoteFee;
          observedCreatorFees = (gross > 0n ? gross : 0n) * BigInt(pledge.creatorFeePct) / 100n;
          observedSecs = Math.max(0, Math.floor(Date.now() / 1000) - pledge.pledgedAt);
        }
        setState({ borrower, market, verification, record, pledge, loan, pool, observedCreatorFees, observedSecs });
      } catch (e: any) {
        if (live) setError(e?.message ?? String(e));
      }
    })();
    return () => { live = false; };
  }, [borrower.wallet, borrower.poolAddress, tick]);

  return { state, error, refresh: () => setTick((t) => t + 1) };
}

/** What a draw of this size would project, for this borrower, right now. */
export function projectionFor(s: BorrowerState, termDays: number): bigint {
  if (!s.pool || !s.pledge || !s.market) return 0n;
  const gross = s.pool.totalTradingQuoteFee - s.pledge.baselineTradingQuoteFee;
  return projectFees({
    observedGross: gross > 0n ? gross : 0n,
    creatorFeePct: s.pledge.creatorFeePct,
    elapsedSecs: s.observedSecs,
    termDays,
    maxExtrapolationRatio: s.market.maxExtrapolationRatio,
  });
}
