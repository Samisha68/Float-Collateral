/* A brand new business, from nothing to a repaid loan.

   This walks the exact journey the web app walks, in the same order, with a
   wallet that has never touched Float: apply to the verifier, launch a pool,
   pledge it, draw, collect, repay. It exists because the app's flows cannot
   be clicked through in a headless browser, and "it compiles" is not evidence
   that a stranger can use the product.

   Run the verifier first:  npm --prefix ../../web run verifier
*/

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
import { connection, wallet, readState, send, readPool, usd, HERE } from "./common.mjs";

const API = process.env.API_URL || "http://localhost:3001";
const DRAW = new BN(process.env.DRAW || 2_000_000_000); // $2,000
const TERM = 30;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const payer = wallet();            // funds the newcomer, and plays the market
const state = readState();
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

const step = (n, label) => console.log(`\n${"─".repeat(60)}\n${n}. ${label}\n${"─".repeat(60)}`);

/* ── 1. A stranger arrives ───────────────────────────────────────────────── */

const newcomer = Keypair.generate();
step(1, "Connect");
console.log(`   wallet ${newcomer.publicKey.toBase58()}`);

await send(
  new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: newcomer.publicKey, lamports: 0.5e9,
  })),
  [payer], "   funded with 0.5 SOL",
);
const theirUsdc = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, newcomer.publicKey)).address;
await mintTo(connection, payer, usdcMint, theirUsdc, payer, 20_000_000_000n);
console.log("   given 20,000 test USDC to repay with");

/* ── 2. Verification, through the same API the form posts to ─────────────── */

step(2, "Get verified");
const res = await fetch(`${API}/api/apply`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: newcomer.publicKey.toBase58(),
    legalName: "Kettle & Co Ltd",
    registrationNumber: "09876543",
    jurisdiction: "United Kingdom",
    companyType: "Private limited",
    representative: "A. Director",
    documentName: "certificate-of-incorporation.pdf",
  }),
});
const approval = await res.json();
if (!res.ok) throw new Error(`verifier refused: ${JSON.stringify(approval.errors)}`);
console.log(`   approved. tx ${approval.signature.slice(0, 24)}…`);
console.log(`   kyb reference on chain: ${approval.kybReference.slice(0, 24)}…`);

const verification = await program.account.businessVerification.fetch(
  seed(Buffer.from("verification"), newcomer.publicKey.toBuffer()),
);
console.log(`   verified=${verification.verified} limit=${usd(verification.creditLimit.toString())}`);
if (!verification.verified) throw new Error("FAIL: not verified on chain");

/* ── 3. They launch a pool, and it trades ────────────────────────────────── */

step(3, "Pledge a fee stream");
const baseKp = Keypair.generate();
await send(
  await client.creator.createPool({
    config, baseMint: baseKp.publicKey, name: "Kettle", symbol: "KTTL",
    uri: "https://example.invalid/kttl.json",
    payer: newcomer.publicKey, poolCreator: newcomer.publicKey,
  }),
  [newcomer, baseKp], "   pool created",
);
const pool = deriveDbcPoolAddress(usdcMint, baseKp.publicKey, config);
console.log(`   pool ${pool.toBase58()}`);

const payerBase = await getAssociatedTokenAddress(baseKp.publicKey, payer.publicKey);
async function churn(rounds, size) {
  for (let i = 0; i < rounds; i++) {
    await send(await client.pool.swap({
      owner: payer.publicKey, pool, amountIn: size, minimumAmountOut: new BN(0),
      swapBaseForQuote: false, referralTokenAccount: null, payer: payer.publicKey,
    }), [payer], `   market buys ${usd(size.toString())}`);
    await nap(700);
    const bal = await getAccount(connection, payerBase).then((a) => a.amount).catch(() => 0n);
    if (bal > 0n) {
      await send(await client.pool.swap({
        owner: payer.publicKey, pool, amountIn: new BN(((bal * 7n) / 10n).toString()),
        minimumAmountOut: new BN(0), swapBaseForQuote: true,
        referralTokenAccount: null, payer: payer.publicKey,
      }), [payer], "   market sells back");
      await nap(700);
    }
  }
}
await churn(1, new BN(3_000_000_000));

const pledge = seed(Buffer.from("pledge"), pool.toBuffer());
await program.methods.pledgePool()
  .accounts({
    borrower: newcomer.publicKey, market,
    verification: seed(Buffer.from("verification"), newcomer.publicKey.toBuffer()),
    virtualPool: pool, poolConfig: config, pledge, poolAuthority,
    dbcEventAuthority, dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([newcomer]).rpc();

const afterPledge = await readPool(pool.toBase58());
console.log(`   creator role now held by ${afterPledge.creator}`);
if (afterPledge.creator !== poolAuthority.toBase58()) throw new Error("FAIL: pledge did not take");

/* ── 4. Wait out the observation window, trade, then draw ────────────────── */

step(4, "Draw");
const m = await program.account.market.fetch(market);
const pl = await program.account.pledgedPool.fetch(pledge);
for (;;) {
  const elapsed = Math.floor(Date.now() / 1000) - pl.pledgedAt.toNumber();
  if (elapsed >= m.observationSecs.toNumber()) break;
  console.log(`   waiting on the observation window: ${elapsed}s of ${m.observationSecs}s`);
  await nap(10_000);
}
await churn(2, new BN(5_000_000_000));

const loan = seed(Buffer.from("loan"), newcomer.publicKey.toBuffer());
const record = seed(Buffer.from("record"), newcomer.publicKey.toBuffer());
const before = await getAccount(connection, theirUsdc).then((a) => a.amount);

await program.methods.borrow(DRAW, TERM)
  .accounts({
    borrower: newcomer.publicKey, market,
    verification: seed(Buffer.from("verification"), newcomer.publicKey.toBuffer()),
    record, virtualPool: pool, pledge, loan, poolAuthority,
    usdcMint, usdcVault, borrowerUsdc: theirUsdc,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  })
  .signers([newcomer]).rpc();

let L = await program.account.loan.fetch(loan);
const after = await getAccount(connection, theirUsdc).then((a) => a.amount);
console.log(`   drew ${usd(L.principal.toString())} at ${L.marginBps / 100}% margin, fee ${usd(L.fee.toString())}`);
console.log(`   their USDC ${usd(before)} to ${usd(after)}`);
if (after - before !== BigInt(L.principal.toString())) throw new Error("FAIL: USDC did not arrive");

/* ── 5. Collect and repay ────────────────────────────────────────────────── */

step(5, "Repay");
const pv = await readPool(pool.toBase58());
const floatBase = (await getOrCreateAssociatedTokenAccount(connection, payer, baseKp.publicKey, poolAuthority, true)).address;
await program.methods.collectFees()
  .accounts({
    cranker: payer.publicKey, market, virtualPool: pool, pledge, loan, poolAuthority,
    dbcPoolAuthority,
    poolBaseVault: new PublicKey(pv.baseVault), poolQuoteVault: new PublicKey(pv.quoteVault),
    baseMint: baseKp.publicKey, floatBaseAccount: floatBase, usdcMint, usdcVault,
    tokenBaseProgram: TOKEN_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID,
    dbcEventAuthority, dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  })
  .rpc();
L = await program.account.loan.fetch(loan);
console.log(`   fees collected ${usd(L.collected.toString())} of ${usd(L.totalDue.toString())} due`);

await program.methods.repay()
  .accounts({
    borrower: newcomer.publicKey, market, record, loan, usdcMint, usdcVault,
    borrowerUsdc: theirUsdc, tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([newcomer]).rpc();

const R = await program.account.businessRecord.fetch(record);
console.log(`   repaid. record now ${R.advancesRepaid}, ${usd(R.totalVolumeRepaid.toString())} of volume`);
console.log(`   next draw prices at ${(15000 - Math.min(R.advancesRepaid, 6) * 500) / 100}% collateral`);

console.log(`\n${"─".repeat(60)}`);
console.log("PASS. A wallet that had never touched Float applied, was verified,");
console.log("launched a pool, pledged it, drew, collected and repaid, and now");
console.log("has a record that prices its next loan.");
console.log(`${"─".repeat(60)}`);
