/* Trade the pool so it has a fee history Float can underwrite.

   Alternates buys and sells rather than only buying. Two reasons: a pool with
   one-way flow is not what a real project's pool looks like, and buying only
   walks the bonding curve toward its migration threshold, past which the pool
   graduates to DAMM v2 and Float stops lending against it. Churn generates the
   fee accrual we need without moving the price much. */

import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { connection, wallet, readState, send, readPool, usd } from "./common.mjs";

const ROUNDS = Number(process.env.ROUNDS || 4);
const BUY = new BN(process.env.BUY || 2_000_000_000); // 2,000 test USDC per buy
const SELL_FRACTION = Number(process.env.SELL_FRACTION || 0.7); // sell most of it back

const payer = wallet();
const state = readState();
if (!state.pool) throw new Error("run 01-create-pool.mjs first");

const client = DynamicBondingCurveClient.create(connection, "confirmed");
const pool = new PublicKey(state.pool);
const baseMint = new PublicKey(state.baseMint);
const baseAta = await getAssociatedTokenAddress(baseMint, payer.publicKey);

const before = await readPool(state.pool);
console.log(`pool ${state.pool}`);
console.log(`before: hasSwap=${before.hasSwap} migrated=${before.isMigrated}`);
console.log(`        totalTradingQuoteFee=${usd(before.totalTradingQuoteFee)} creatorQuoteFee=${usd(before.creatorQuoteFee)}\n`);

const swap = async (amountIn, baseForQuote, label) => {
  const tx = await client.pool.swap({
    owner: payer.publicKey,
    pool,
    amountIn,
    minimumAmountOut: new BN(0),
    swapBaseForQuote: baseForQuote,
    referralTokenAccount: null,
    payer: payer.publicKey,
  });
  await send(tx, [payer], label);
};

for (let i = 1; i <= ROUNDS; i++) {
  await swap(BUY, false, `round ${i}/${ROUNDS} buy  ${usd(BUY.toString())}`);

  const bal = await getAccount(connection, baseAta).then((a) => a.amount).catch(() => 0n);
  const sell = new BN(((bal * BigInt(Math.round(SELL_FRACTION * 1000))) / 1000n).toString());
  if (sell.gtn(0)) {
    await swap(sell, true, `round ${i}/${ROUNDS} sell back`);
  }

  const mid = await readPool(state.pool);
  if (mid.isMigrated) {
    console.log("\npool migrated off the curve; stopping");
    break;
  }
}

const after = await readPool(state.pool);
console.log(`\nafter:  hasSwap=${after.hasSwap} migrated=${after.isMigrated}`);
console.log(`        totalTradingQuoteFee=${usd(after.totalTradingQuoteFee)} creatorQuoteFee=${usd(after.creatorQuoteFee)}`);

const gross = after.totalTradingQuoteFee - before.totalTradingQuoteFee;
console.log(`\ngross accrued this run: ${usd(gross)}`);
console.log(`creator share at 50%:   ${usd(gross / 2n)}`);

if (state.pledge) {
  const p = await import("@coral-xyz/anchor");
  console.log(`\nsince pledge baseline, Float observes:`);
  console.log(`  gross  ${usd(after.totalTradingQuoteFee - BigInt(128_000_000))}`);
}
if (!after.hasSwap) throw new Error("pool still reports hasSwap=false");
