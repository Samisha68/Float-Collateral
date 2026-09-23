/* The centrepiece screen's data, read from Solana rather than written in React.

   Two verified businesses with the same approved credit limit. One has never
   borrowed; the other has repaid six times. The limit is identical and the
   terms are not. Everything below comes from BusinessVerification and
   BusinessRecord accounts on devnet; the only thing computed here is the
   pricing, from the same ladder the program uses. */

import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { connection, wallet, readState, writeState, usd, HERE } from "./common.mjs";

const CREDIT_LIMIT = new BN(10_000_000_000); // $10,000 for both
const SAMPLE_DRAW = 5_000_000_000n;          // the same $5,000 ask
const TERM_DAYS = 30;

const payer = wallet();
let state = readState();
const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../target/idl/float_credit.json"), "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const PID = program.programId;
const V = Buffer.from([2]);
const seed = (...p) => PublicKey.findProgramAddressSync(p, PID)[0];
const market = seed(Buffer.from("market"), V);

/* Borrower A: verified, never borrowed. The admin wallet has a record of its
   own from earlier testing, so A gets its own key rather than doubling up. */
let alice;
if (state.borrowerA) {
  alice = Keypair.fromSecretKey(Uint8Array.from(state.borrowerA));
} else {
  alice = Keypair.generate();
  state = writeState({ borrowerA: Array.from(alice.secretKey) });
  console.log("created borrower A");
}
const vA = seed(Buffer.from("verification"), alice.publicKey.toBuffer());
if (!(await connection.getAccountInfo(vA))) {
  await program.methods.verifyBusiness(Array.from(Buffer.alloc(32, 3)), CREDIT_LIMIT)
    .accounts({ verifier: payer.publicKey, market, borrower: alice.publicKey,
      verification: vA, record: seed(Buffer.from("record"), alice.publicKey.toBuffer()),
      systemProgram: SystemProgram.programId })
    .rpc();
  console.log("verified borrower A\n");
}

const bob = Keypair.fromSecretKey(Uint8Array.from(state.borrowerB));

/* Float's published ladder. Same numbers as pricing.mjs and pricing.rs. */
const RATE_POINTS = [[0, 0], [7, 60], [14, 100], [30, 180], [45, 250], [60, 320]];
const baseRateBps = (d) => {
  const i = Math.max(1, RATE_POINTS.findIndex((p) => p[0] >= d));
  const [lx, ly] = RATE_POINTS[i - 1], [hx, hy] = RATE_POINTS[i];
  return ly + Math.floor(((hy - ly) * (d - lx)) / (hx - lx));
};
const marginBps = (n) => 15000 - Math.min(n, 6) * 500;
const rateBps = (d, n) => {
  const b = baseRateBps(d);
  return Math.max(b - Math.min(n, 6) * 10, Math.floor(b / 2));
};

async function view(name, kp) {
  const v = await program.account.businessVerification.fetch(
    seed(Buffer.from("verification"), kp.publicKey.toBuffer()));
  const r = await program.account.businessRecord.fetch(
    seed(Buffer.from("record"), kp.publicKey.toBuffer()));
  const n = r.advancesRepaid;
  const m = marginBps(n), rate = rateBps(TERM_DAYS, n);
  return {
    name, wallet: kp.publicKey.toBase58(),
    verified: v.verified,
    limit: BigInt(v.creditLimit.toString()),
    repaid: n,
    volume: BigInt(r.totalVolumeRepaid.toString()),
    overdue: r.advancesOverdue,
    marginPct: m / 100,
    ratePct: rate / 100,
    collateralNeeded: (SAMPLE_DRAW * BigInt(m)) / 10_000n,
  };
}

const A = await view("NEW BUSINESS", alice);
const B = await view("PROVEN BUSINESS", bob);

const row = (label, a, b) =>
  console.log(`  ${label.padEnd(26)} ${String(a).padStart(16)}   ${String(b).padStart(16)}`);

console.log("=".repeat(68));
console.log("  SAME CREDIT LIMIT. DIFFERENT HISTORY. DIFFERENT TERMS.");
console.log("=".repeat(68));
console.log(`  ${"".padEnd(26)} ${A.name.padStart(16)}   ${B.name.padStart(16)}`);
console.log("-".repeat(68));
row("Status", A.verified ? "VERIFIED" : "UNVERIFIED", B.verified ? "VERIFIED" : "UNVERIFIED");
row("Approved credit", usd(A.limit), usd(B.limit));
row("Successful repayments", A.repaid, B.repaid);
row("Overdue", A.overdue, B.overdue);
row("Total repaid", usd(A.volume), usd(B.volume));
console.log("-".repeat(68));
row("Collateral requirement", A.marginPct + "%", B.marginPct + "%");
row("Rate (30 days)", A.ratePct + "%", B.ratePct + "%");
console.log("-".repeat(68));
console.log(`  For the same ${usd(SAMPLE_DRAW)} draw:`);
row("Coverage needed", usd(A.collateralNeeded), usd(B.collateralNeeded));
console.log("=".repeat(68));
console.log(`  The limit is identical. The record is what moved the terms.`);
console.log(`  Difference in coverage required: ${usd(A.collateralNeeded - B.collateralNeeded)}`);
console.log("");
console.log(`  A  ${A.wallet}`);
console.log(`  B  ${B.wallet}`);
