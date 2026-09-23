/* Trade the pool so it has a fee history to underwrite.

   Float will not lend against a pool that has never traded, and it projects a
   run rate from fees accrued since the pledge. Both need real swaps. This
   buys the base token a few times with test USDC; the 2% trading fee accrues,
   and the creator's half of it becomes the collateral Float lends against. */

import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { connection, wallet, readState, send, readPool, usd } from "./common.mjs";

const ROUNDS = Number(process.env.ROUNDS || 4);
const SIZE = new BN(process.env.SIZE || 2_000_000_000); // 2,000 test USDC per buy

const payer = wallet();
const state = readState();
if (!state.pool) throw new Error("run 01-create-pool.mjs first");

const client = DynamicBondingCurveClient.create(connection, "confirmed");
const pool = new PublicKey(state.pool);

const before = await readPool(state.pool);
console.log(`pool ${state.pool}`);
console.log(`before: hasSwap=${before.hasSwap} totalTradingQuoteFee=${usd(before.totalTradingQuoteFee)} creatorQuoteFee=${usd(before.creatorQuoteFee)}\n`);

for (let i = 1; i <= ROUNDS; i++) {
  const tx = await client.pool.swap({
    owner: payer.publicKey,
    pool,
    amountIn: SIZE,
    minimumAmountOut: new BN(0),
    swapBaseForQuote: false, // buy base with quote
    referralTokenAccount: null,
    payer: payer.publicKey,
  });
  await send(tx, [payer], `swap ${i}/${ROUNDS} (${usd(SIZE.toString())} in)`);
}

const after = await readPool(state.pool);
console.log(`\nafter:  hasSwap=${after.hasSwap} totalTradingQuoteFee=${usd(after.totalTradingQuoteFee)} creatorQuoteFee=${usd(after.creatorQuoteFee)}`);

const gross = after.totalTradingQuoteFee - before.totalTradingQuoteFee;
console.log(`\ngross trading fee accrued this run: ${usd(gross)}`);
console.log(`creator share at 50%:               ${usd(gross / 2n)}`);
if (!after.hasSwap) throw new Error("pool still reports hasSwap=false");
if (after.creatorQuoteFee === 0n) throw new Error("no creator fee accrued; check collectFeeMode and creatorTradingFeePercentage");
console.log("\nPool is lendable: it has traded and pays its creator a quote-denominated fee.");
