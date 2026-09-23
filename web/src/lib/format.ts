/* Money in, readable strings out. USDC is six decimals throughout. */

export const USDC_DECIMALS = 6;

export function usd(base: bigint | number | string, opts: { cents?: boolean } = {}): string {
  const n = Number(BigInt(base.toString())) / 10 ** USDC_DECIMALS;
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
}

export function pct(bps: number, dp = 1): string {
  return (bps / 100).toFixed(dp) + "%";
}

/** A term fee is not an APR, and a business reading this thinks in APR.
    Show both rather than pick one and be quietly misleading. */
export function annualised(bps: number, days: number): string {
  if (days <= 0) return "";
  return ((bps / 100) * (365 / days)).toFixed(1) + "% APR";
}

export function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function shortKey(k: string): string {
  return k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k;
}

export const explorer = (k: string, kind: "address" | "tx" = "address") =>
  `https://explorer.solana.com/${kind}/${k}?cluster=devnet`;

/** "1 minute", "3 minutes". Small thing; wrong plurals read as carelessness. */
export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Seconds as the coarsest honest unit. */
export function duration(secs: number): string {
  if (secs < 60) return plural(secs, "second");
  const m = Math.floor(secs / 60);
  if (m < 60) return plural(m, "minute");
  const h = Math.floor(m / 60);
  if (h < 48) return plural(h, "hour");
  return plural(Math.floor(h / 24), "day");
}
