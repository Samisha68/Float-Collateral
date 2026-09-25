/* The second collateral rail, end to end on devnet.

   Float's first rail is a fee stream: it cannot be seized, so the record does
   the underwriting and margin walks 150% down to 120%. This rail is the
   opposite kind of asset. An escrowed token CAN be seized, but its price moves
   while the loan is open, so it posts more up front: 200% down to 170%.

   The collateral is a Token-2022 mint with a 20bps transfer fee and 9
   decimals, modelled on T-OpenAI. That is deliberate. A transfer fee means the
   vault receives less than the borrower sent, and a lender that credits the
   amount *asked for* rather than the amount *arrived* is under-collateralised
   by construction. This script checks the difference rather than asserting it.

   Run the verifier first:  npm --prefix ../../web run verifier
*/

import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ExtensionType,
  getMintLen, createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, getAccount, mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { connection, wallet, readState, send, usd, HERE } from "./common.mjs";

const API = process.env.API_URL || "http://localhost:3001";

const payer = wallet();
const state = readState();
const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../target/idl/float_credit.json"), "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const PID = program.programId;
const V = Buffer.from([2]);
const seed = (...p) => PublicKey.findProgramAddressSync(p, PID)[0];

const market = seed(Buffer.from("market"), V);
const usdcVault = seed(Buffer.from("usdc_vault"), V);
const usdcMint = new PublicKey(state.usdcMint);

/* The collateral. 9 decimals and 20bps, as T-OpenAI has. */
const DECIMALS = 9;
const FEE_BPS = 20;
const ONE = 10n ** BigInt(DECIMALS);
const PRICE = 40_000_000;          // $40.00 per token, 6dp like USDC
const DEPOSIT = 500n * ONE;        // 500 tokens, nominally $20,000
const DRAW = new BN(5_000_000_000); // $5,000
const TERM = 30;

const step = (n, label) => console.log(`\n${"─".repeat(64)}\n${n}. ${label}\n${"─".repeat(64)}`);
const tok = (b) => (Number(b) / Number(ONE)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const fail = (m) => { throw new Error(`FAIL: ${m}`); };

/* ── 1. A business, verified through the same API the form posts to ─────── */

const borrower = Keypair.generate();
step(1, "A verified business");
console.log(`   wallet ${borrower.publicKey.toBase58()}`);

await send(new Transaction().add(SystemProgram.transfer({
  fromPubkey: payer.publicKey, toPubkey: borrower.publicKey, lamports: 0.35e9,
})), [payer], "   funded with 0.35 SOL");

const res = await fetch(`${API}/api/apply`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: borrower.publicKey.toBase58(),
    legalName: "Harbour Freight Systems Ltd",
    registrationNumber: "11223344",
    jurisdiction: "United Kingdom",
    companyType: "Private limited",
    representative: "R. Okafor",
    documentName: "certificate-of-incorporation.pdf",
  }),
});
const approval = await res.json();
if (!res.ok) fail(`verifier refused: ${JSON.stringify(approval.errors)}`);
const verification = seed(Buffer.from("verification"), borrower.publicKey.toBuffer());
const vAcc = await program.account.businessVerification.fetch(verification);
console.log(`   verified=${vAcc.verified}  approved limit ${usd(vAcc.creditLimit.toString())}`);
if (!vAcc.verified) fail("not verified on chain");

/* ── 2. A Token-2022 collateral mint that charges to move ───────────────── */

step(2, "The collateral: Token-2022 with a 20bps transfer fee");
const mintKp = Keypair.generate();
const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
const rent = await connection.getMinimumBalanceForRentExemption(mintLen);
await send(new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey, newAccountPubkey: mintKp.publicKey,
    space: mintLen, lamports: rent, programId: TOKEN_2022_PROGRAM_ID,
  }),
  createInitializeTransferFeeConfigInstruction(
    mintKp.publicKey, payer.publicKey, payer.publicKey,
    FEE_BPS, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID,
  ),
  createInitializeMintInstruction(
    mintKp.publicKey, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID,
  ),
), [payer, mintKp], "   mint created");
const collateralMint = mintKp.publicKey;
console.log(`   mint ${collateralMint.toBase58()}  ${DECIMALS}dp  ${FEE_BPS}bps transfer fee`);

const theirTokens = getAssociatedTokenAddressSync(collateralMint, borrower.publicKey, false, TOKEN_2022_PROGRAM_ID);
await send(new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(
  payer.publicKey, theirTokens, borrower.publicKey, collateralMint, TOKEN_2022_PROGRAM_ID,
)), [payer], "   borrower token account");
await mintTo(connection, payer, collateralMint, theirTokens, payer, DEPOSIT, [], undefined, TOKEN_2022_PROGRAM_ID);

const theirUsdc = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, borrower.publicKey)).address;
await mintTo(connection, payer, usdcMint, theirUsdc, payer, 20_000_000_000n);
console.log(`   holds ${tok(DEPOSIT)} tokens and 20,000 test USDC to repay with`);

/* ── 3. Float posts a price ─────────────────────────────────────────────── */

step(3, "Post a price");
const priceFeed = seed(Buffer.from("price"), collateralMint.toBuffer());
await program.methods.postPrice(new BN(PRICE))
  .accounts({
    publisher: payer.publicKey, market, collateralMint, priceFeed,
    systemProgram: SystemProgram.programId,
  }).rpc();
const feed = await program.account.priceFeed.fetch(priceFeed);
console.log(`   ${usd(feed.price.toString())} per token, published by ${feed.publisher.toBase58().slice(0, 8)}…`);
console.log(`   RELAYED PRICE. Float's own key publishes it; there is no oracle here.`);

/* ── 4. Deposit, and count what actually arrived ────────────────────────── */

step(4, "Escrow the collateral");
const position = seed(Buffer.from("token_collateral"), borrower.publicKey.toBuffer(), collateralMint.toBuffer());
const tokenVault = seed(Buffer.from("token_vault"), collateralMint.toBuffer());

await program.methods.depositTokenCollateral(new BN(DEPOSIT.toString()))
  .accounts({
    borrower: borrower.publicKey, market, verification, collateralMint,
    position, tokenVault, borrowerTokens: theirTokens,
    tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([borrower]).rpc();

const pos = await program.account.tokenCollateral.fetch(position);
const vaultBal = (await getAccount(connection, tokenVault, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
const expectedFee = (DEPOSIT * BigInt(FEE_BPS)) / 10_000n;
const credited = BigInt(pos.amount.toString());

console.log(`   sent      ${tok(DEPOSIT)}`);
console.log(`   fee took  ${tok(expectedFee)}   (${FEE_BPS}bps, withheld by the mint)`);
console.log(`   credited  ${tok(credited)}`);
console.log(`   vault has ${tok(vaultBal)}`);
if (credited === DEPOSIT) fail("credited the amount asked for, not the amount received — the transfer fee was ignored");
if (credited !== DEPOSIT - expectedFee) fail(`credited ${credited}, expected ${DEPOSIT - expectedFee}`);
if (credited !== vaultBal) fail(`position says ${credited} but the vault holds ${vaultBal}`);
console.log(`   PASS: the position records what arrived, not what was asked for.`);

/* ── 5. The collateral sets the ceiling ─────────────────────────────────── */

step(5, "What this collateral can carry");
const record = seed(Buffer.from("record"), borrower.publicKey.toBuffer());
const loan = seed(Buffer.from("loan"), V, borrower.publicKey.toBuffer());
const value = (credited * BigInt(PRICE)) / ONE;
const MARGIN = 20_000; // a new borrower on the token rail
const ceiling = (value * 10_000n) / BigInt(MARGIN);
console.log(`   collateral value  ${usd(value)}`);
console.log(`   margin            ${MARGIN / 100}%  (new borrower, token rail)`);
console.log(`   most it can carry ${usd(ceiling)}`);
console.log(`   approved limit    ${usd(vAcc.creditLimit.toString())}`);
console.log(`   so the ceiling is ${usd(ceiling < BigInt(vAcc.creditLimit.toString()) ? ceiling : vAcc.creditLimit.toString())} — the lower of the two`);

const borrowAccounts = {
  borrower: borrower.publicKey, market, verification, record, collateralMint,
  priceFeed, position, loan, usdcMint, usdcVault, borrowerUsdc: theirUsdc,
  tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
};

const tooMuch = new BN((ceiling + 1_000_000n).toString());
console.log(`\n   asking for ${usd(tooMuch.toString())}, which is over the ceiling…`);
let refused = false;
try {
  await program.methods.borrowAgainstTokens(tooMuch, TERM)
    .accounts(borrowAccounts).signers([borrower]).rpc();
} catch (e) {
  refused = true;
  const m = String(e).match(/InsufficientCollateralValue|ExceedsApprovedCredit/);
  console.log(`   refused: ${m ? m[0] : String(e).slice(0, 120)}`);
}
if (!refused) fail("the program funded a loan its collateral cannot carry");
console.log(`   PASS: you get the value of your collateral, not the value of your ask.`);

/* ── 6. Draw inside the ceiling ─────────────────────────────────────────── */

step(6, "Draw");
const usdcBefore = (await getAccount(connection, theirUsdc)).amount;
await program.methods.borrowAgainstTokens(DRAW, TERM)
  .accounts(borrowAccounts).signers([borrower]).rpc();

let L = await program.account.loan.fetch(loan);
const usdcAfter = (await getAccount(connection, theirUsdc)).amount;
console.log(`   drew ${usd(L.principal.toString())} at ${L.marginBps / 100}% margin for ${L.termDays} days`);
console.log(`   fee ${usd(L.fee.toString())}, total due ${usd(L.totalDue.toString())}`);
console.log(`   collateral kind on the loan: ${Object.keys(L.collateralKind)[0]}`);
console.log(`   their USDC ${usd(usdcBefore)} → ${usd(usdcAfter)}`);
if (usdcAfter - usdcBefore !== BigInt(L.principal.toString())) fail("USDC did not arrive");
if (L.marginBps !== MARGIN) fail(`margin was ${L.marginBps}, expected ${MARGIN}`);
if (Object.keys(L.collateralKind)[0] !== "token") fail("loan is not tagged as token-collateralised");
console.log(`   PASS: funded, and tagged as the rail it came from.`);

/* ── 7. The collateral is locked while the loan is open ─────────────────── */

step(7, "Locked while it is owed");
let lockedOk = false;
try {
  await program.methods.withdrawTokenCollateral(new BN(credited.toString()))
    .accounts({
      borrower: borrower.publicKey, market, collateralMint, position, loan,
      tokenVault, borrowerTokens: theirTokens, tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).signers([borrower]).rpc();
} catch (e) {
  lockedOk = true;
  const m = String(e).match(/LoanStillActive/);
  console.log(`   withdrawal refused: ${m ? m[0] : String(e).slice(0, 120)}`);
}
if (!lockedOk) fail("the borrower walked off with collateral against an open loan");
console.log(`   PASS.`);

/* ── 8. Repay, then take the collateral back ────────────────────────────── */

step(8, "Repay and release");
await program.methods.repay()
  .accounts({
    borrower: borrower.publicKey, market, record, loan, usdcMint, usdcVault,
    borrowerUsdc: theirUsdc, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([borrower]).rpc();

L = await program.account.loan.fetch(loan);
const R = await program.account.businessRecord.fetch(record);
console.log(`   loan status ${Object.keys(L.status)[0]}`);
console.log(`   record now ${R.advancesRepaid} repaid, ${usd(R.totalVolumeRepaid.toString())} of volume`);

const heldBefore = (await getAccount(connection, theirTokens, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
await program.methods.withdrawTokenCollateral(new BN(credited.toString()))
  .accounts({
    borrower: borrower.publicKey, market, collateralMint, position, loan,
    tokenVault, borrowerTokens: theirTokens, tokenProgram: TOKEN_2022_PROGRAM_ID,
  }).signers([borrower]).rpc();
const heldAfter = (await getAccount(connection, theirTokens, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
const posAfter = await program.account.tokenCollateral.fetch(position);
console.log(`   their tokens ${tok(heldBefore)} → ${tok(heldAfter)}  (the fee bites on the way out too)`);
console.log(`   position now ${tok(BigInt(posAfter.amount.toString()))}`);
if (BigInt(posAfter.amount.toString()) !== 0n) fail("position did not clear");
if (heldAfter <= heldBefore) fail("collateral did not come back");
console.log(`   PASS.`);

/* ── 9. What the record bought them ─────────────────────────────────────── */

step(9, "The record moves both rails");
const nextToken = 20_000 - Math.min(R.advancesRepaid, 6) * 500;
const nextFee = 15_000 - Math.min(R.advancesRepaid, 6) * 500;
console.log(`   after ${R.advancesRepaid} repayment, their next draw prices at:`);
console.log(`     token collateral  ${nextToken / 100}%   (was ${MARGIN / 100}%)`);
console.log(`     a fee stream      ${nextFee / 100}%   (was 150%)`);
console.log(`   Same ladder, different starting point. The asset sets where you`);
console.log(`   begin; the record is what moves you.`);

console.log(`\n${"─".repeat(64)}`);
console.log("PASS. Token collateral works end to end: priced, escrowed net of a");
console.log("Token-2022 transfer fee, borrowed against at a margin the asset");
console.log("earns, locked while owed, and released on repayment.");
console.log(`${"─".repeat(64)}`);
