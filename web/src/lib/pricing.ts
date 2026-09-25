/* Float's published pricing, in the browser.

   These are the same numbers as `program/programs/float_credit/src/pricing.rs`
   and Float's own `web/server/pricing.mjs`. One ladder, three places that have
   to agree; `pricing.test.ts` fails if this copy drifts from the program's.

   The rule the shape encodes: a repayment record buys a better price, never a
   bigger advance. */

/* Two rails, one ladder.

   A fee stream cannot be seized. If it dries up, Float's recourse is the
   record and the borrower's own USDC, so the record has to do the
   underwriting and the rail starts at 150%.

   An escrowed token CAN be seized, which sounds safer and is — but its price
   moves while the loan is open, and a seizure at the wrong moment recovers
   less than the screen said it was worth. So it starts higher, at 200%, and
   walks the same six steps down.

   The asset decides where you begin. The record is what moves you. */
export type CollateralKind = "feeStream" | "token";

export const BASE_MARGIN_BPS = 15_000;
/** +50 points on the token rail: 200% down to 170%. */
export const TOKEN_HAIRCUT_BPS = 5_000;
export const MARGIN_STEP_BPS = 500;
export const FEE_STEP_BPS = 10;
export const RECORD_STEPS = 6;

const RATE_POINTS: [number, number][] = [
  [0, 0], [7, 60], [14, 100], [30, 180], [45, 250], [60, 320],
];

/** Coverage required: 150% at no record, 120% at six repayments. */
export function marginBps(repayments: number): number {
  return BASE_MARGIN_BPS - Math.min(repayments, RECORD_STEPS) * MARGIN_STEP_BPS;
}

/** Coverage required on a given rail. */
export function marginBpsFor(kind: CollateralKind, repayments: number): number {
  return marginBps(repayments) + (kind === "token" ? TOKEN_HAIRCUT_BPS : 0);
}

/** What a holding is worth in USDC, at a posted price. Mirrors the program's
    `token_value_usdc`: integer division, so it rounds the borrower's way. */
export function tokenValueUsdc(amount: bigint, price: bigint, decimals: number): bigint {
  return (amount * price) / 10n ** BigInt(decimals);
}

/** The most a given collateral value can carry on a rail. This is the number
    the user asked for: you get the value of your collateral, not the value of
    your ask. */
export function collateralCeiling(
  value: bigint, kind: CollateralKind, repayments: number,
): bigint {
  return (value * 10_000n) / BigInt(marginBpsFor(kind, repayments));
}

/** The published fee for a term, before any record discount. */
export function baseRateBps(days: number): number {
  let i = RATE_POINTS.findIndex((p) => p[0] >= days);
  if (i < 0) i = RATE_POINTS.length - 1;
  const [hx, hy] = RATE_POINTS[Math.max(1, i)];
  const [lx, ly] = RATE_POINTS[Math.max(0, Math.max(1, i) - 1)];
  if (hx === lx) return hy;
  return ly + Math.floor(((hy - ly) * (days - lx)) / (hx - lx));
}

/** What this borrower pays. Never below half the published rate. */
export function rateBps(days: number, repayments: number): number {
  const base = baseRateBps(days);
  const earned = Math.min(repayments, RECORD_STEPS) * FEE_STEP_BPS;
  return Math.max(base - earned, Math.floor(base / 2));
}

/** Fee in USDC base units, rounded up so Float is never short a remainder. */
export function feeAmount(principal: bigint, days: number, repayments: number): bigint {
  const bps = BigInt(rateBps(days, repayments));
  const num = principal * bps;
  return num % 10_000n === 0n ? num / 10_000n : num / 10_000n + 1n;
}

/** Coverage a draw needs at this borrower's tier, on a given rail. */
export function coverageRequired(
  draw: bigint, repayments: number, kind: CollateralKind = "feeStream",
): bigint {
  const m = BigInt(marginBpsFor(kind, repayments));
  const num = draw * m;
  return num % 10_000n === 0n ? num / 10_000n : num / 10_000n + 1n;
}

/** What one more repayment would change. Null once the record stops earning. */
export function nextStep(repayments: number, kind: CollateralKind = "feeStream") {
  if (repayments >= RECORD_STEPS) return null;
  return {
    marginFrom: marginBpsFor(kind, repayments) / 100,
    marginTo: marginBpsFor(kind, repayments + 1) / 100,
    remaining: RECORD_STEPS - repayments,
  };
}

/** The tier name a borrower is standing in. Words, not a score. */
export function tierName(repayments: number): string {
  if (repayments >= 6) return "TRUSTED";
  if (repayments >= 4) return "PROVEN";
  if (repayments >= 2) return "ESTABLISHED";
  return "STARTING";
}
