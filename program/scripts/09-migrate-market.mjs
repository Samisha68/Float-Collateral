import fs from "node:fs";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { connection, wallet, HERE } from "./common.mjs";

const payer = wallet();
const idl = JSON.parse(fs.readFileSync(path.join(HERE, "../target/idl/float_credit.json"), "utf8"));
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const V = Buffer.from([2]);
const market = PublicKey.findProgramAddressSync([Buffer.from("market"), V], program.programId)[0];

const before = await program.account.market.fetch(market);
console.log("before: publisher =", before.pricePublisher.toBase58(), " liqMargin =", before.liquidationMarginBps);

if (before.pricePublisher.toBase58() === payer.publicKey.toBase58() && before.liquidationMarginBps === 12500) {
  console.log("already migrated, nothing to do");
} else {
  const sig = await program.methods
    .setPriceConfig(payer.publicKey, 12500)
    .accounts({ admin: payer.publicKey, market })
    .rpc();
  console.log("tx", sig);
}

const after = await program.account.market.fetch(market);
console.log("after:  publisher =", after.pricePublisher.toBase58(), " liqMargin =", after.liquidationMarginBps);
console.log("untouched: admin =", after.admin.toBase58());
console.log("untouched: verifier =", after.verifier.toBase58());
console.log("untouched: advancesFunded =", after.advancesFunded.toString(), " outstanding =", after.principalOutstanding.toString());
if (after.pricePublisher.toBase58() !== payer.publicKey.toBase58()) throw new Error("FAIL: publisher not set");
if (after.liquidationMarginBps !== 12500) throw new Error("FAIL: liquidation margin not set");
console.log("PASS");
