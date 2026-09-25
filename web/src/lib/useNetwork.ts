/* What Float has actually done, read from devnet.

   The landing page makes claims. Claims on a lending site are cheap, and a
   judge has read a hundred of them today. These are the same numbers the
   program enforces, fetched from the same accounts the app reads, so the page
   is making its case with evidence rather than adjectives.

   It degrades quietly. Devnet rate-limits, and a landing page that renders a
   spinner forever because an RPC was busy is worse than one that simply does
   not show the figures. */

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getFloatAccounts, getRecordsFor } from "./chain";
import { BORROWERS } from "./useBorrower";

export type NetworkStats = {
  advancesFunded: number;
  repaidCount: number;
  totalRepaid: bigint;
  outstanding: bigint;
  businesses: number;
};

/* The figures are the most persuasive thing on the landing page and the
   public devnet endpoint drops requests freely, so a single attempt means the
   evidence disappears at random. Retried, and remembered between visits: the
   counts only ever grow, so a cached value is a real number that is at worst
   a few seconds behind, and it is replaced the moment a fetch succeeds. */
const CACHE_KEY = "float.network.v1";

function readCache(): NetworkStats | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      advancesFunded: p.advancesFunded,
      repaidCount: p.repaidCount,
      totalRepaid: BigInt(p.totalRepaid),
      outstanding: BigInt(p.outstanding),
      businesses: p.businesses,
    };
  } catch { return null; }
}

function writeCache(s: NetworkStats) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ...s, totalRepaid: s.totalRepaid.toString(), outstanding: s.outstanding.toString(),
    }));
  } catch { /* blocked or full */ }
}

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useNetwork() {
  const [stats, setStats] = useState<NetworkStats | null>(() => readCache());

  useEffect(() => {
    let live = true;
    (async () => {
      const wallets = BORROWERS.map((b) => new PublicKey(b.wallet));
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const [{ market }, rows] = await Promise.all([
            getFloatAccounts(wallets[0], null),
            getRecordsFor(wallets),
          ]);
          if (!live) return;
          if (!market) throw new Error("no market");
          const next: NetworkStats = {
            advancesFunded: market.advancesFunded,
            repaidCount: rows.reduce((n, r) => n + r.record.advancesRepaid, 0),
            totalRepaid: rows.reduce((n, r) => n + r.record.totalVolumeRepaid, 0n),
            outstanding: market.principalOutstanding,
            businesses: rows.filter((r) => r.verification?.verified).length,
          };
          setStats(next);
          writeCache(next);
          return;
        } catch {
          if (attempt === 2) return; // keep whatever the cache gave us
          await nap(700 * 2 ** attempt);
        }
      }
    })();
    return () => { live = false; };
  }, []);

  return stats;
}
