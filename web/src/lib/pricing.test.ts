/* The pricing ladder exists in three places and they have to agree.

   `program/programs/float_credit/src/pricing.rs` is the one that matters —
   it is what the chain enforces. This file and `web/server/pricing.mjs` are
   copies for the browser and the verifier, and a copy that drifts is worse
   than no copy: the app quotes a number, the borrower signs, and the program
   refuses.

   So the expected values below are written out by hand from the Rust, not
   derived from the TypeScript. A test that computes its expectation the same
   way as the code under test proves only that the code is self-consistent. */

import { describe, it, expect } from "vitest";
import {
  marginBps, marginBpsFor, baseRateBps, rateBps, feeAmount,
  coverageRequired, collateralCeiling, tokenValueUsdc, nextStep, tierName,
  BASE_MARGIN_BPS, TOKEN_HAIRCUT_BPS, RECORD_STEPS,
} from "./pricing";

describe("the margin ladder", () => {
  it("matches pricing.rs on the fee-stream rail", () => {
    // 150, 145, 140, 135, 130, 125, 120 — then it stops.
    expect([0, 1, 2, 3, 4, 5, 6, 7, 99].map(marginBps)).toEqual([
      15_000, 14_500, 14_000, 13_500, 13_000, 12_500, 12_000, 12_000, 12_000,
    ]);
  });

  it("starts the token rail 50 points higher and walks the same steps", () => {
    // 200 down to 170.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => marginBpsFor("token", n))).toEqual([
      20_000, 19_500, 19_000, 18_500, 18_000, 17_500, 17_000, 17_000,
    ]);
  });

  it("leaves the fee-stream rail exactly where it was", () => {
    for (let n = 0; n <= 8; n++) {
      expect(marginBpsFor("feeStream", n)).toBe(marginBps(n));
    }
  });

  it("keeps the two rails a fixed haircut apart", () => {
    for (let n = 0; n <= RECORD_STEPS; n++) {
      expect(marginBpsFor("token", n) - marginBpsFor("feeStream", n)).toBe(TOKEN_HAIRCUT_BPS);
    }
  });

  it("never lets the record change the starting point", () => {
    expect(marginBpsFor("feeStream", 0)).toBe(BASE_MARGIN_BPS);
    expect(marginBpsFor("token", 0)).toBe(BASE_MARGIN_BPS + TOKEN_HAIRCUT_BPS);
  });
});

describe("the rate ladder", () => {
  it("matches the published points", () => {
    expect(baseRateBps(7)).toBe(60);
    expect(baseRateBps(14)).toBe(100);
    expect(baseRateBps(30)).toBe(180);
    expect(baseRateBps(45)).toBe(250);
    expect(baseRateBps(60)).toBe(320);
  });

  it("discounts a record but never below half", () => {
    expect(rateBps(30, 0)).toBe(180);
    expect(rateBps(30, 6)).toBe(120);
    // 6 steps of 10bps would take a 7-day loan from 60 to 0; the floor holds.
    expect(rateBps(7, 6)).toBe(30);
  });

  it("prices the fee the way the program does: rounded up", () => {
    // $5,000 for 30 days at 180bps is exactly $90.00 — the devnet loop's number.
    expect(feeAmount(5_000_000_000n, 30, 0)).toBe(90_000_000n);
    // A remainder rounds toward Float, never away.
    expect(feeAmount(1n, 30, 0)).toBe(1n);
  });
});

describe("what collateral can carry", () => {
  it("values a holding the way token_value_usdc does", () => {
    // 499 tokens at 9dp, $40.00 each.
    expect(tokenValueUsdc(499_000_000_000n, 40_000_000n, 9)).toBe(19_960_000_000n);
  });

  it("rounds a valuation down, not up", () => {
    expect(tokenValueUsdc(1n, 1n, 9)).toBe(0n);
  });

  it("asks for more coverage on the token rail than the fee-stream rail", () => {
    const draw = 5_000_000_000n; // $5,000
    expect(coverageRequired(draw, 0, "feeStream")).toBe(7_500_000_000n); // 150%
    expect(coverageRequired(draw, 0, "token")).toBe(10_000_000_000n);    // 200%
  });

  it("rounds required coverage up", () => {
    expect(coverageRequired(1n, 0, "feeStream")).toBe(2n); // 1.5 → 2
  });

  it("turns a collateral value into a ceiling", () => {
    // $19,960 of escrow at 200% supports $9,980 — the devnet script's number.
    expect(collateralCeiling(19_960_000_000n, "token", 0)).toBe(9_980_000_000n);
    // The same escrow, after six repayments at 170%.
    expect(collateralCeiling(19_960_000_000n, "token", 6)).toBe(11_741_176_470n);
  });

  it("is the inverse of coverageRequired", () => {
    const value = 19_960_000_000n;
    const ceiling = collateralCeiling(value, "token", 0);
    expect(coverageRequired(ceiling, 0, "token")).toBeLessThanOrEqual(value);
    expect(coverageRequired(ceiling + 1n, 0, "token")).toBeGreaterThan(value);
  });
});

describe("what a borrower is told", () => {
  it("reports the next step on the rail they are standing on", () => {
    expect(nextStep(0, "feeStream")).toEqual({ marginFrom: 150, marginTo: 145, remaining: 6 });
    expect(nextStep(0, "token")).toEqual({ marginFrom: 200, marginTo: 195, remaining: 6 });
  });

  it("stops promising improvement once the ladder ends", () => {
    expect(nextStep(6, "token")).toBeNull();
    expect(nextStep(9, "feeStream")).toBeNull();
  });

  it("names a tier in words", () => {
    expect([0, 2, 4, 6].map(tierName)).toEqual(["STARTING", "ESTABLISHED", "PROVEN", "TRUSTED"]);
  });
});
