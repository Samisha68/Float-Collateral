/* The negative test: once pledged, the borrower cannot claim the fees.

   Everything else in this project rests on this. If the original creator can
   still route the pool's fees to themselves after pledging, the collateral is
   a promise rather than a lock, and Float is an unsecured lender wearing a
   costume. So we make the borrower try, and require that Meteora refuses. */

import { PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { connection, wallet, readState, readPool, usd } from "./common.mjs";

const payer = wallet();
const state = readState();
const client = DynamicBondingCurveClient.create(connection, "confirmed");

const view = await readPool(state.pool);
console.log(`pool            ${state.pool}`);
console.log(`creator now     ${view.creator}`);
console.log(`float PDA       ${state.poolAuthority}`);
console.log(`borrower        ${payer.publicKey.toBase58()}`);
console.log(`unclaimed fees  ${usd(view.creatorQuoteFee)}\n`);

if (view.creator !== state.poolAuthority) {
  throw new Error("pool is not pledged to Float; run 03-pledge.mjs first");
}

console.log("borrower attempts claim_creator_trading_fee on a pledged pool...");
let refused = false;
let reason = "";
try {
  const tx = await client.creator.claimCreatorTradingFee({
    creator: payer.publicKey,
    pool: new PublicKey(state.pool),
    maxBaseAmount: new BN(0),
    maxQuoteAmount: new BN("18446744073709551615"),
    payer: payer.publicKey,
  });
  tx.feePayer = payer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(payer);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`  UNEXPECTED SUCCESS: ${sig}`);
} catch (e) {
  refused = true;
  reason = (e.message || String(e)).split("\n")[0];
  console.log(`  refused: ${reason}`);
}

const after = await readPool(state.pool);
console.log(`\nunclaimed fees after attempt: ${usd(after.creatorQuoteFee)}`);

if (!refused) throw new Error("FAIL: the borrower was able to claim fees on a pledged pool");
if (after.creatorQuoteFee !== view.creatorQuoteFee) {
  throw new Error("FAIL: fees moved despite the refusal");
}
console.log("\nPASS: Meteora refused the borrower, and the fees are untouched.");
console.log("The pledge is a lock enforced by Meteora, not a promise enforced by Float.");
