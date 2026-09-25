/* What happens when the collateral stops covering the loan.

   This is the difference between the two rails, made concrete. A fee stream
   cannot be seized — if it dries up, Float's recourse is the record and the
   borrower's own USDC. An escrowed token CAN be seized, and that is the whole
   reason it starts at a lower margin than its face value suggests.

   So the token rail owes an answer to a question the fee-stream rail never
   faces: the price moved against you, now what? This script moves the price
   and finds out.

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

const payer = wallet();               // Float, and also the liquidator here
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

const DECIMALS = 9;
const FEE_BPS = 20;
const ONE = 10n ** BigInt(DECIMALS);
const PRICE = 40_000_000;
const DEPOSIT = 500n * ONE;
const DRAW = new BN(5_000_000_000);
const TERM = 30;

const step = (n, label) => console.log(`\n${"─".repeat(64)}\n${n}. ${label}\n${"─".repeat(64)}`);
const tok = (b) => (Number(b) / Number(ONE)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const fail = (m) => { throw new Error(`FAIL: ${m}`); };

/* ── Setup: a funded, drawn position on the token rail ──────────────────── */

const borrower = Keypair.generate();
step(1, "A business with a drawn loan against escrowed tokens");
console.log(`   wallet ${borrower.publicKey.toBase58()}`);

await send(new Transaction().add(SystemProgram.transfer({
  fromPubkey: payer.publicKey, toPubkey: borrower.publicKey, lamports: 0.35e9,
})), [payer], "   funded with 0.35 SOL");

const res = await fetch(`${API}/api/apply`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: borrower.publicKey.toBase58(),
    legalName: "Pennine Textiles Ltd",
    registrationNumber: "55667788",
    jurisdiction: "United Kingdom",
    companyType: "Private limited",
    representative: "S. Bhatt",
    documentName: "certificate-of-incorporation.pdf",
  }),
});
if (!res.ok) fail(`verifier refused: ${JSON.stringify((await res.json()).errors)}`);
const verification = seed(Buffer.from("verification"), borrower.publicKey.toBuffer());

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
  createInitializeMintInstruction(mintKp.publicKey, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
), [payer, mintKp], "   collateral mint created");
const collateralMint = mintKp.publicKey;

const theirTokens = getAssociatedTokenAddressSync(collateralMint, borrower.publicKey, false, TOKEN_2022_PROGRAM_ID);
const mine = getAssociatedTokenAddressSync(collateralMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
await send(new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, theirTokens, borrower.publicKey, collateralMint, TOKEN_2022_PROGRAM_ID),
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, mine, payer.publicKey, collateralMint, TOKEN_2022_PROGRAM_ID),
), [payer], "   token accounts");
await mintTo(connection, payer, collateralMint, theirTokens, payer, DEPOSIT, [], undefined, TOKEN_2022_PROGRAM_ID);
const theirUsdc = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, borrower.publicKey)).address;
const myUsdc = (await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey)).address;
await mintTo(connection, payer, usdcMint, myUsdc, payer, 20_000_000_000n);

const priceFeed = seed(Buffer.from("price"), collateralMint.toBuffer());
const position = seed(Buffer.from("token_collateral"), borrower.publicKey.toBuffer(), collateralMint.toBuffer());
const tokenVault = seed(Buffer.from("token_vault"), collateralMint.toBuffer());
const record = seed(Buffer.from("record"), borrower.publicKey.toBuffer());
const loan = seed(Buffer.from("loan"), V, borrower.publicKey.toBuffer());

const postPrice = (p) => program.methods.postPrice(new BN(p))
  .accounts({ publisher: payer.publicKey, market, collateralMint, priceFeed, systemProgram: SystemProgram.programId })
  .rpc();

await postPrice(PRICE);
await program.methods.depositTokenCollateral(new BN(DEPOSIT.toString()))
  .accounts({
    borrower: borrower.publicKey, market, verification, collateralMint,
    position, tokenVault, borrowerTokens: theirTokens,
    tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([borrower]).rpc();
await program.methods.borrowAgainstTokens(DRAW, TERM)
  .accounts({
    borrower: borrower.publicKey, market, verification, record, collateralMint,
    priceFeed, position, loan, usdcMint, usdcVault, borrowerUsdc: theirUsdc,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([borrower]).rpc();

const pos = await program.account.tokenCollateral.fetch(position);
const held = BigInt(pos.amount.toString());
let L = await program.account.loan.fetch(loan);
const M = await program.account.market.fetch(market);
const totalDue = BigInt(L.totalDue.toString());
console.log(`   escrowed ${tok(held)} tokens at ${usd(PRICE)} each`);
console.log(`   drew ${usd(L.principal.toString())}, total due ${usd(totalDue)}`);
console.log(`   liquidation line: ${M.liquidationMarginBps / 100}% of what is owed = ${usd((totalDue * BigInt(M.liquidationMarginBps)) / 10_000n)}`);

/* ── 2. A healthy position is not anyone's to take ──────────────────────── */

step(2, "The price dips, but the position still covers");
const DIP = 16_000_000; // $16.00 → 499 × 16 = $7,984 vs a $6,362.50 line
await postPrice(DIP);
console.log(`   price ${usd(PRICE)} → ${usd(DIP)}`);
console.log(`   collateral now worth ${usd((held * BigInt(DIP)) / ONE)}, line is ${usd((totalDue * BigInt(M.liquidationMarginBps)) / 10_000n)}`);

const liqAccounts = {
  liquidator: payer.publicKey, market, collateralMint, priceFeed, position, loan,
  record, usdcMint, usdcVault, tokenVault, liquidatorUsdc: myUsdc,
  liquidatorTokens: mine,
  tokenProgram: TOKEN_2022_PROGRAM_ID, usdcTokenProgram: TOKEN_PROGRAM_ID,
};

let healthy = false;
try {
  await program.methods.liquidateTokenCollateral().accounts(liqAccounts).rpc();
} catch (e) {
  healthy = true;
  const m = String(e).match(/PositionIsHealthy/);
  console.log(`   seizure refused: ${m ? m[0] : String(e).slice(0, 140)}`);
}
if (!healthy) fail("a covered position was seized — the borrower lost their term for nothing");
console.log(`   PASS: above the line, the borrower keeps their term.`);

/* ── 3. Below the line, anyone may settle it ────────────────────────────── */

step(3, "The price falls through the line");
const CRASH = 12_000_000; // $12.00 → 499 × 12 = $5,988 vs a $6,362.50 line
await postPrice(CRASH);
const crashedValue = (held * BigInt(CRASH)) / ONE;
console.log(`   price ${usd(DIP)} → ${usd(CRASH)}`);
console.log(`   collateral now worth ${usd(crashedValue)}, below the ${usd((totalDue * BigInt(M.liquidationMarginBps)) / 10_000n)} line`);

const myUsdcBefore = (await getAccount(connection, myUsdc)).amount;
const myTokBefore = (await getAccount(connection, mine, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
const vaultBefore = (await getAccount(connection, usdcVault)).amount;

await program.methods.liquidateTokenCollateral().accounts(liqAccounts).rpc();

const myUsdcAfter = (await getAccount(connection, myUsdc)).amount;
const myTokAfter = (await getAccount(connection, mine, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
const vaultAfter = (await getAccount(connection, usdcVault)).amount;
L = await program.account.loan.fetch(loan);
const posAfter = await program.account.tokenCollateral.fetch(position);
const R = await program.account.businessRecord.fetch(record);

console.log(`   liquidator paid   ${usd(myUsdcBefore - myUsdcAfter)}`);
console.log(`   Float's vault     ${usd(vaultBefore)} → ${usd(vaultAfter)}  (+${usd(vaultAfter - vaultBefore)})`);
console.log(`   liquidator took   ${tok(myTokAfter - myTokBefore)} tokens`);
console.log(`   loan status       ${Object.keys(L.status)[0]}`);
console.log(`   position          ${tok(BigInt(posAfter.amount.toString()))}`);
console.log(`   record            ${R.advancesRepaid} repaid, ${R.advancesOverdue} not`);

if (myUsdcBefore - myUsdcAfter !== totalDue) fail(`liquidator paid ${myUsdcBefore - myUsdcAfter}, debt was ${totalDue}`);
if (vaultAfter - vaultBefore !== totalDue) fail("Float's vault was not made whole");
if (Object.keys(L.status)[0] !== "liquidated") fail("loan not marked liquidated");
if (BigInt(posAfter.amount.toString()) !== 0n) fail("position did not clear");
if (myTokAfter <= myTokBefore) fail("liquidator did not receive the collateral");
if (R.advancesOverdue !== 1) fail("the record does not show the loss");

const took = myTokAfter - myTokBefore;
const tookValue = (took * BigInt(CRASH)) / ONE;
const coverage = Number(crashedValue * 10_000n / totalDue) / 100;
console.log(`\n   PASS. Float was repaid in full, the liquidator holds the tokens,`);
console.log(`   and the borrower's record carries the failure into their next`);
console.log(`   application.`);
console.log(`\n   The liquidator's side: paid ${usd(totalDue)}, received ${tok(took)} tokens`);
console.log(`   worth ${usd(tookValue)} at ${usd(CRASH)}. That margin is the incentive, and`);
console.log(`   it exists only because the seizure happened at ${coverage}% coverage`);
console.log(`   rather than below 100%.`);
console.log(`\n   The honest caveat: nothing here guarantees someone acts in that`);
console.log(`   window. There is no keeper and no seizure discount, so if the`);
console.log(`   price gaps straight through 100% the loss is Float's. A`);
console.log(`   production design needs both. Neither is built.`);

console.log(`\n${"─".repeat(64)}`);
console.log("PASS. The token rail can be seized when it stops covering, which is");
console.log("exactly what the fee-stream rail cannot do — and why the two rails");
console.log("start at different margins.");
console.log(`${"─".repeat(64)}`);
