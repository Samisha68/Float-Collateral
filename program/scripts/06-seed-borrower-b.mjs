/* Borrower B: six real repayment cycles, so the comparison screen reads state
   rather than a fixture.

   The whole argument of this product is that a proven borrower gets better
   terms than a new one. If the "6 repayments" in that screen were a constant
   in React, the argument would be a mockup. So B is a separate wallet with a
   separate pool, and it earns its record the only way the program allows:
   by borrowing and repaying six times.

   Resumable. It reads B's on-chain record and continues from whatever cycle
   it is actually on, because devnet rate limits make a clean single run
   unlikely. */

import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress, getAccount,
  mintTo, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  DynamicBondingCurveClient, deriveDbcPoolAddress,
  deriveDbcEventAuthority, deriveDbcPoolAuthority,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { connection, wallet, readState, writeState, send, readPool, usd, HERE } from "./common.mjs";

const TARGET_CYCLES = 6;
const DRAWS = [3_000, 3_500, 4_000, 4_500, 5_000, 5_000].map((n) => new BN(n * 1_000_000));
const TERM_DAYS = 30;
const CREDIT_LIMIT = new BN(10_000_000_000); // $10,000, same as borrower A
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const payer = wallet();
let state = readState();
const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../target/idl/float_credit.json"), "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const PID = program.programId;
const V = Buffer.from([2]);
const seed = (...p) => PublicKey.findProgramAddressSync(p, PID)[0];

const market = seed(Buffer.from("market"), V);
const poolAuthority = seed(Buffer.from("pool_authority"));
const usdcVault = seed(Buffer.from("usdc_vault"), V);
const usdcMint = new PublicKey(state.usdcMint);
const config = new PublicKey(state.dbcConfig);
const dbcEventAuthority = deriveDbcEventAuthority();
const dbcPoolAuthority = deriveDbcPoolAuthority();
const client = DynamicBondingCurveClient.create(connection, "confirmed");

/* 1. Borrower B's wallet. */
let bob;
if (state.borrowerB) {
  bob = Keypair.fromSecretKey(Uint8Array.from(state.borrowerB));
} else {
  bob = Keypair.generate();
  state = writeState({ borrowerB: Array.from(bob.secretKey) });
}
console.log(`borrower B  ${bob.publicKey.toBase58()}`);

/* 2. Fund B: SOL for rent and fees, test USDC to repay with. */
if ((await connection.getBalance(bob.publicKey)) < 0.4e9) {
  console.log("  funding B with 0.6 SOL...");
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: bob.publicKey, lamports: 0.6e9,
  }));
  await send(tx, [payer], "fund B");
}
const bobUsdc = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, bob.publicKey)).address;
if ((await getAccount(connection, bobUsdc)).amount < 60_000_000_000n) {
  await mintTo(connection, payer, usdcMint, bobUsdc, payer, 100_000_000_000n);
  console.log("  minted 100,000 test USDC to B");
}

/* 3. B's own pool. The pledge is per pool and must belong to the borrower,
      so B cannot share A's. */
if (!state.poolB) {
  console.log("\ncreating B's pool...");
  const baseKp = Keypair.generate();
  const tx = await client.creator.createPool({
    config, baseMint: baseKp.publicKey, name: "Bravo Labs", symbol: "BRAVO",
    uri: "https://example.invalid/bravo.json",
    payer: bob.publicKey, poolCreator: bob.publicKey,
  });
  await send(tx, [bob, baseKp], "createPool B");
  const p = deriveDbcPoolAddress(usdcMint, baseKp.publicKey, config);
  state = writeState({ poolB: p.toBase58(), baseMintB: baseKp.publicKey.toBase58() });
  console.log(`  pool B ${p.toBase58()}`);
}
const poolB = new PublicKey(state.poolB);
const baseMintB = new PublicKey(state.baseMintB);
const pledgeB = seed(Buffer.from("pledge"), poolB.toBuffer());
const verificationB = seed(Buffer.from("verification"), bob.publicKey.toBuffer());
const recordB = seed(Buffer.from("record"), bob.publicKey.toBuffer());
const loanB = seed(Buffer.from("loan"), bob.publicKey.toBuffer());
const floatBaseB = (await getOrCreateAssociatedTokenAccount(connection, payer, baseMintB, poolAuthority, true)).address;

/* Trading B's pool. Anyone may trade it; the payer plays the market. */
const payerBase = await getAssociatedTokenAddress(baseMintB, payer.publicKey);
async function churn(rounds, size) {
  for (let i = 0; i < rounds; i++) {
    const buy = await client.pool.swap({
      owner: payer.publicKey, pool: poolB, amountIn: size,
      minimumAmountOut: new BN(0), swapBaseForQuote: false,
      referralTokenAccount: null, payer: payer.publicKey,
    });
    await send(buy, [payer], `  trade buy ${usd(size.toString())}`);
    await nap(800);
    const bal = await getAccount(connection, payerBase).then((a) => a.amount).catch(() => 0n);
    if (bal > 0n) {
      const sell = await client.pool.swap({
        owner: payer.publicKey, pool: poolB, amountIn: new BN(((bal * 7n) / 10n).toString()),
        minimumAmountOut: new BN(0), swapBaseForQuote: true,
        referralTokenAccount: null, payer: payer.publicKey,
      });
      await send(sell, [payer], "  trade sell back");
      await nap(800);
    }
  }
}

/* Mirror of the program's projection, so the script can tell when a draw will
   actually clear instead of guessing at trade volume. If these two ever
   disagree, one of them is wrong and it is worth knowing which. */
async function projection(termDays) {
  const m = await program.account.market.fetch(market);
  const pl = await program.account.pledgedPool.fetch(pledgeB);
  const pv = await readPool(state.poolB);
  const elapsed = BigInt(Math.floor(Date.now() / 1000) - pl.pledgedAt.toNumber());
  if (elapsed <= 0n) return { projected: 0n, observedGross: 0n, creatorShare: 0n, elapsed };
  const observedGross = pv.totalTradingQuoteFee - BigInt(pl.baselineTradingQuoteFee.toString());
  const creatorShare = (observedGross * BigInt(pl.creatorFeePct)) / 100n;
  const termSecs = BigInt(termDays) * 86_400n;
  const ceiling = elapsed * BigInt(m.maxExtrapolationRatio);
  const horizon = termSecs < ceiling ? termSecs : ceiling;
  return { projected: (creatorShare * horizon) / elapsed, observedGross, creatorShare, elapsed };
}

/* Trade until the pool's observed run rate actually supports the draw. This is
   the demo standing in for a real pool's organic volume. */
async function ensureCoverage(draw, marginBps) {
  const required = (BigInt(draw.toString()) * BigInt(marginBps)) / 10_000n;
  for (let attempt = 0; attempt < 12; attempt++) {
    const p = await projection(TERM_DAYS);
    console.log(`  coverage: projected ${usd(p.projected)} vs required ${usd(required)} (observed gross ${usd(p.observedGross)})`);
    if (p.projected >= required) return;
    const pv = await readPool(state.poolB);
    if (pv.isMigrated) throw new Error("B's pool migrated off the curve; cannot lend against it");
    await churn(1, new BN(6_000_000_000));
  }
  throw new Error("could not build enough observed fee accrual for this draw");
}

/* 4. Verify B, same limit as A. The limit is what must NOT differ. */
console.log("\nverify_business(B)...");
await program.methods.verifyBusiness(Array.from(Buffer.alloc(32, 11)), CREDIT_LIMIT)
  .accounts({ verifier: payer.publicKey, market, borrower: bob.publicKey,
    verification: verificationB, record: recordB, systemProgram: SystemProgram.programId })
  .rpc();

/* 5. Pledge B's pool, then let it trade so there is a run rate to underwrite. */
let viewB = await readPool(state.poolB);
if (viewB.creator !== poolAuthority.toBase58()) {
  if (!viewB.hasSwap) { console.log("\nseeding B's pool with trades..."); await churn(2, new BN(3_000_000_000)); }
  console.log("\npledge_pool(B)...");
  await program.methods.pledgePool()
    .accounts({ borrower: bob.publicKey, market, verification: verificationB,
      virtualPool: poolB, poolConfig: config, pledge: pledgeB, poolAuthority,
      dbcEventAuthority, dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
      systemProgram: SystemProgram.programId })
    .signers([bob]).rpc();
  console.log("  pledged");
}

/* 6. Wait out the observation window. Float will not project a run rate from
      a pool it has not watched trade, so the first draw has to wait for it. */
{
  const m = await program.account.market.fetch(market);
  const pl = await program.account.pledgedPool.fetch(pledgeB);
  const need = m.observationSecs.toNumber();
  for (;;) {
    const elapsed = Math.floor(Date.now() / 1000) - pl.pledgedAt.toNumber();
    if (elapsed >= need) { console.log(`observation window satisfied (${elapsed}s of ${need}s)`); break; }
    console.log(`  waiting on observation window: ${elapsed}s of ${need}s`);
    await nap(10_000);
  }
}

/* 7. Six cycles. */
let record = await program.account.businessRecord.fetch(recordB);
console.log(`\nB currently has ${record.advancesRepaid} repayments; target ${TARGET_CYCLES}\n`);

while (record.advancesRepaid < TARGET_CYCLES) {
  const n = record.advancesRepaid;
  const draw = DRAWS[Math.min(n, DRAWS.length - 1)];
  const margin = (15000 - Math.min(n, 6) * 500) / 100;
  console.log("=".repeat(60));
  console.log(`CYCLE ${n + 1}/${TARGET_CYCLES}   draw ${usd(draw.toString())} at ${margin}% margin`);
  console.log("=".repeat(60));

  // Keep the pool trading so the observed run rate supports the draw.
  await ensureCoverage(draw, 15000 - Math.min(n, 6) * 500);

  const pv = await readPool(state.poolB);
  await program.methods.borrow(draw, TERM_DAYS)
    .accounts({ borrower: bob.publicKey, market, verification: verificationB, record: recordB,
      virtualPool: poolB, pledge: pledgeB, loan: loanB, poolAuthority, usdcMint, usdcVault,
      borrowerUsdc: bobUsdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([bob]).rpc();
  let L = await program.account.loan.fetch(loanB);
  console.log(`  borrowed ${usd(L.principal.toString())}  fee ${usd(L.fee.toString())}  margin ${L.marginBps / 100}%`);
  await nap(1000);

  await program.methods.collectFees()
    .accounts({ cranker: payer.publicKey, market, virtualPool: poolB, pledge: pledgeB, loan: loanB,
      poolAuthority, dbcPoolAuthority,
      poolBaseVault: new PublicKey(pv.baseVault), poolQuoteVault: new PublicKey(pv.quoteVault),
      baseMint: baseMintB, floatBaseAccount: floatBaseB, usdcMint, usdcVault,
      tokenBaseProgram: TOKEN_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID,
      dbcEventAuthority, dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID })
    .rpc();
  L = await program.account.loan.fetch(loanB);
  console.log(`  fees collected ${usd(L.collected.toString())} of ${usd(L.totalDue.toString())} due`);
  await nap(1000);

  await program.methods.repay()
    .accounts({ borrower: bob.publicKey, market, record: recordB, loan: loanB, usdcMint,
      usdcVault, borrowerUsdc: bobUsdc, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([bob]).rpc();
  record = await program.account.businessRecord.fetch(recordB);
  console.log(`  repaid. record now ${record.advancesRepaid}, next margin ${(15000 - Math.min(record.advancesRepaid, 6) * 500) / 100}%\n`);
  await nap(1000);
}

console.log("=".repeat(60));
console.log("BORROWER B FINAL RECORD (read from Solana)");
console.log("=".repeat(60));
console.log(`  wallet              ${bob.publicKey.toBase58()}`);
console.log(`  advances taken      ${record.advancesTaken}`);
console.log(`  advances repaid     ${record.advancesRepaid}`);
console.log(`  advances overdue    ${record.advancesOverdue}`);
console.log(`  total volume repaid ${usd(record.totalVolumeRepaid.toString())}`);
console.log(`  margin now          ${(15000 - Math.min(record.advancesRepaid, 6) * 500) / 100}%`);
writeState({ poolAuthority: poolAuthority.toBase58(), market: market.toBase58(), usdcVault: usdcVault.toBase58() });
