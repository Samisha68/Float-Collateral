/* The pledge round-trip: hand Meteora's creator role to Float, and prove it moved.

   This is the security model in one transaction. The borrower signs, Float's
   program CPIs Meteora's transfer_pool_creator, and afterwards the pool's
   creator is Float's PDA. From that point the borrower cannot claim the
   pool's fees and Float can. Nothing here is taken on trust: the program
   re-reads the pool after the CPI and fails if the role did not move. */

import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  deriveDbcEventAuthority,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { connection, wallet, readState, writeState, readPool, usd, HERE } from "./common.mjs";

const OBSERVATION_SECS = Number(process.env.OBSERVATION_SECS || 60);
const MAX_EXTRAPOLATION = Number(process.env.MAX_EXTRAPOLATION || 30);
const CREDIT_LIMIT = new BN(10_000_000_000); // $10,000

const payer = wallet();
const state = readState();
if (!state.pool) throw new Error("run 01-create-pool.mjs and 02-trade.mjs first");

const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../target/idl/float_credit.json"), "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const PROGRAM_ID = program.programId;
console.log(`float_credit ${PROGRAM_ID.toBase58()}`);

const usdcMint = new PublicKey(state.usdcMint);
const pool = new PublicKey(state.pool);
const config = new PublicKey(state.dbcConfig);

const seed = (...parts) => PublicKey.findProgramAddressSync(parts, PROGRAM_ID)[0];
const market = seed(Buffer.from("market"), Buffer.from([2]));
const poolAuthority = seed(Buffer.from("pool_authority"));
const usdcVault = seed(Buffer.from("usdc_vault"), Buffer.from([2]));
const verification = seed(Buffer.from("verification"), payer.publicKey.toBuffer());
const record = seed(Buffer.from("record"), payer.publicKey.toBuffer());
const pledge = seed(Buffer.from("pledge"), pool.toBuffer());
const dbcEventAuthority = deriveDbcEventAuthority();

console.log(`  market          ${market.toBase58()}`);
console.log(`  pool_authority  ${poolAuthority.toBase58()}`);
console.log(`  usdc_vault      ${usdcVault.toBase58()}`);
console.log(`  pledge          ${pledge.toBase58()}`);
console.log(`  dbc event auth  ${dbcEventAuthority.toBase58()}\n`);

/* 1. Market. */
if (!(await connection.getAccountInfo(market))) {
  console.log(`init_market (window ${OBSERVATION_SECS}s, extrapolation cap ${MAX_EXTRAPOLATION}x)...`);
  const sig = await program.methods
    .initMarket(new BN(OBSERVATION_SECS), MAX_EXTRAPOLATION)
    .accounts({
      admin: payer.publicKey,
      market,
      poolAuthority,
      usdcMint,
      usdcVault,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ${sig}`);
  // Fund the vault so it can actually disburse.
  await mintTo(connection, payer, usdcMint, usdcVault, payer, 500_000_000_000n);
  console.log("  vault funded with 500,000 test USDC");
} else {
  console.log("market exists");
}

/* 2. Verify the business. Reputation cannot touch this limit. */
console.log(`\nverify_business (limit ${usd(CREDIT_LIMIT.toString())})...`);
const kyb = Array.from(Buffer.alloc(32, 7));
const sigV = await program.methods
  .verifyBusiness(kyb, CREDIT_LIMIT)
  .accounts({
    verifier: payer.publicKey,
    market,
    borrower: payer.publicKey,
    verification,
    record,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`  ${sigV}`);

/* 3. The pledge. */
const before = await readPool(state.pool);
console.log(`\nbefore pledge: creator = ${before.creator}`);
if (before.creator === poolAuthority.toBase58()) {
  console.log("  already pledged to Float");
} else {
  console.log("pledge_pool...");
  const sigP = await program.methods
    .pledgePool()
    .accounts({
      borrower: payer.publicKey,
      market,
      verification,
      pledge,
      poolAuthority,
      virtualPool: pool,
      poolConfig: config,
      dbcEventAuthority,
      dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ${sigP}`);
}

const after = await readPool(state.pool);
console.log(`after pledge:  creator = ${after.creator}`);

const p = await program.account.pledgedPool.fetch(pledge);
console.log("\nPledgedPool as Float recorded it:");
console.log(`  borrower                    ${p.borrower.toBase58()}`);
console.log(`  pool                        ${p.pool.toBase58()}`);
console.log(`  creatorFeePct               ${p.creatorFeePct}%`);
console.log(`  baselineTradingQuoteFee     ${usd(p.baselineTradingQuoteFee.toString())}`);
console.log(`  pledgedAt                   ${new Date(p.pledgedAt.toNumber() * 1000).toISOString()}`);
console.log(`  released                    ${p.released}`);

writeState({ market: market.toBase58(), poolAuthority: poolAuthority.toBase58(), usdcVault: usdcVault.toBase58(), pledge: pledge.toBase58() });

if (after.creator !== poolAuthority.toBase58()) {
  throw new Error("FAIL: creator role did not move to Float's PDA");
}
console.log("\nPASS: Meteora now reports Float's PDA as the pool creator.");
console.log("The borrower can no longer claim this pool's creator fees.");
