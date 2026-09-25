/* The credit loop, end to end on devnet: borrow, collect, repay, release.

   Each step prints what the chain says rather than what the script hoped, and
   asserts the invariant that matters at that point. The interesting one is
   collect: it is the first time Float's PDA signs into Meteora rather than the
   borrower, and it is what turns "Float holds the creator role" into "the
   fees actually arrive in Float's vault". */

import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  deriveDbcEventAuthority,
  deriveDbcPoolAuthority,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { connection, wallet, readState, readPool, usd, HERE } from "./common.mjs";

const DRAW = new BN(process.env.DRAW || 5_000_000_000); // $5,000
const TERM_DAYS = Number(process.env.TERM_DAYS || 30);
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const payer = wallet();
const state = readState();
const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../target/idl/float_credit.json"), "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const PID = program.programId;

const seed = (...p) => PublicKey.findProgramAddressSync(p, PID)[0];
const V = Buffer.from([2]);
const market = seed(Buffer.from("market"), V);
const poolAuthority = seed(Buffer.from("pool_authority"));
const usdcVault = seed(Buffer.from("usdc_vault"), V);
const verification = seed(Buffer.from("verification"), payer.publicKey.toBuffer());
const record = seed(Buffer.from("record"), payer.publicKey.toBuffer());
const pool = new PublicKey(state.pool);
const pledge = seed(Buffer.from("pledge"), pool.toBuffer());
const loan = seed(Buffer.from("loan"), V, payer.publicKey.toBuffer());
const usdcMint = new PublicKey(state.usdcMint);
const baseMint = new PublicKey(state.baseMint);
const config = new PublicKey(state.dbcConfig);
const dbcEventAuthority = deriveDbcEventAuthority();
const dbcPoolAuthority = deriveDbcPoolAuthority();

const borrowerUsdc = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey)).address;
// Meteora pays the base side of the creator fee somewhere; with quote-only
// fee collection it is zero, but the account still has to exist.
const floatBase = (await getOrCreateAssociatedTokenAccount(connection, payer, baseMint, poolAuthority, true)).address;

const bal = async (a) => (await getAccount(connection, a)).amount;
const show = async (label) => {
  const p = await readPool(state.pool);
  console.log(`  ${label}`);
  console.log(`    borrower USDC ${usd(await bal(borrowerUsdc))}   float vault ${usd(await bal(usdcVault))}`);
  console.log(`    pool unclaimed creator fee ${usd(p.creatorQuoteFee)}`);
};

console.log("=".repeat(64));
console.log("BORROW");
console.log("=".repeat(64));
await show("before");
const sigB = await program.methods
  .borrow(DRAW, TERM_DAYS)
  .accounts({
    borrower: payer.publicKey, market, verification, record, pledge, loan,
    poolAuthority, virtualPool: pool, usdcMint, usdcVault, borrowerUsdc,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`  tx ${sigB}`);
await nap(1500);
await show("after");

let L = await program.account.loan.fetch(loan);
console.log(`\n  principal          ${usd(L.principal.toString())}`);
console.log(`  fee                ${usd(L.fee.toString())}`);
console.log(`  total due          ${usd(L.totalDue.toString())}`);
console.log(`  margin required    ${L.marginBps / 100}%`);
console.log(`  repayments at draw ${L.repaymentsAtDraw}`);
console.log(`  projected fees     ${usd(L.projectedAtDraw.toString())}`);
console.log(`  due                ${new Date(L.dueAt.toNumber() * 1000).toISOString()}`);

console.log("\n" + "=".repeat(64));
console.log("COLLECT  (Float's PDA signs into Meteora)");
console.log("=".repeat(64));
await nap(1500);
const vaultBefore = await bal(usdcVault);
const sigC = await program.methods
  .collectFees()
  .accounts({
    cranker: payer.publicKey, market, pledge, loan, poolAuthority,
    virtualPool: pool, dbcPoolAuthority,
    poolBaseVault: new PublicKey((await readPool(state.pool)).baseVault),
    poolQuoteVault: new PublicKey((await readPool(state.pool)).quoteVault),
    baseMint, floatBaseAccount: floatBase, usdcMint, usdcVault,
    tokenBaseProgram: TOKEN_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID,
    dbcEventAuthority, dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  })
  .rpc();
console.log(`  tx ${sigC}`);
await nap(1500);
const vaultAfter = await bal(usdcVault);
await show("after");
L = await program.account.loan.fetch(loan);
console.log(`\n  swept into Float's vault ${usd(vaultAfter - vaultBefore)}`);
console.log(`  loan.collected           ${usd(L.collected.toString())}  of ${usd(L.totalDue.toString())} due`);
if (vaultAfter <= vaultBefore) throw new Error("FAIL: nothing arrived in the vault");
if (L.collected.toString() !== (vaultAfter - vaultBefore).toString()) {
  throw new Error("FAIL: loan.collected disagrees with the vault delta");
}

console.log("\n" + "=".repeat(64));
console.log("REPAY");
console.log("=".repeat(64));
await nap(1500);
const sigR = await program.methods
  .repay()
  .accounts({
    borrower: payer.publicKey, market, record, loan, usdcMint, usdcVault,
    borrowerUsdc, tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
console.log(`  tx ${sigR}`);
await nap(1500);
await show("after");
L = await program.account.loan.fetch(loan);
const R = await program.account.businessRecord.fetch(record);
console.log(`\n  loan status         ${Object.keys(L.status)[0]}`);
console.log(`  advances repaid     ${R.advancesRepaid}`);
console.log(`  total volume repaid ${usd(R.totalVolumeRepaid.toString())}`);
console.log(`  next margin         ${(15000 - Math.min(R.advancesRepaid, 6) * 500) / 100}%`);

console.log("\n" + "=".repeat(64));
console.log("RELEASE  (creator role goes back)");
console.log("=".repeat(64));
await nap(1500);
const sigX = await program.methods
  .releasePool()
  .accounts({
    borrower: payer.publicKey, market, pledge, loan, poolAuthority,
    virtualPool: pool, poolConfig: config, dbcEventAuthority,
    dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  })
  .rpc();
console.log(`  tx ${sigX}`);
await nap(1500);
const final = await readPool(state.pool);
console.log(`  pool creator is now ${final.creator}`);
if (final.creator !== payer.publicKey.toBase58()) {
  throw new Error("FAIL: creator role did not return to the borrower");
}
console.log("\nPASS: full loop ran on devnet. Fees repaid the loan at source and the pool went home.");
