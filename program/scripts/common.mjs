/* Shared plumbing for the devnet scripts.

   Every script is re-runnable: state lands in scripts/state.json and is read
   back on the next run, so a half-finished setup can be resumed rather than
   started over. That matters because creating a DBC pool costs real devnet
   SOL and rate limits are real. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = path.join(HERE, "state.json");
export const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

export const connection = new Connection(RPC, "confirmed");

export function wallet() {
  const file = process.env.WALLET || path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export function readState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

export function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export const pk = (v) => (v ? new PublicKey(v) : null);

export function usd(base) {
  return "$" + (Number(base) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

export async function send(tx, signers, label) {
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`  ${label}: ${sig}`);
  return sig;
}

/* Float reads Meteora pool state by byte offset in the program. These mirrors
   let the scripts assert the same fields from the client side, so a layout
   drift shows up here too and not only inside a failing instruction. */
export const VP = {
  CONFIG: 72,
  CREATOR: 104,
  BASE_MINT: 136,
  BASE_VAULT: 168,
  QUOTE_VAULT: 200,
  IS_MIGRATED: 305,
  TOTAL_TRADING_QUOTE_FEE: 336,
  CREATOR_BASE_FEE: 352,
  CREATOR_QUOTE_FEE: 360,
  HAS_SWAP: 370,
};

export async function readPool(pool) {
  const info = await connection.getAccountInfo(new PublicKey(pool));
  if (!info) throw new Error(`pool not found: ${pool}`);
  const d = info.data;
  if (d.length !== 424) throw new Error(`unexpected VirtualPool size ${d.length}, expected 424`);
  return {
    size: d.length,
    config: new PublicKey(d.subarray(VP.CONFIG, VP.CONFIG + 32)).toBase58(),
    creator: new PublicKey(d.subarray(VP.CREATOR, VP.CREATOR + 32)).toBase58(),
    baseMint: new PublicKey(d.subarray(VP.BASE_MINT, VP.BASE_MINT + 32)).toBase58(),
    baseVault: new PublicKey(d.subarray(VP.BASE_VAULT, VP.BASE_VAULT + 32)).toBase58(),
    quoteVault: new PublicKey(d.subarray(VP.QUOTE_VAULT, VP.QUOTE_VAULT + 32)).toBase58(),
    isMigrated: d[VP.IS_MIGRATED] !== 0,
    hasSwap: d[VP.HAS_SWAP] !== 0,
    totalTradingQuoteFee: d.readBigUInt64LE(VP.TOTAL_TRADING_QUOTE_FEE),
    creatorBaseFee: d.readBigUInt64LE(VP.CREATOR_BASE_FEE),
    creatorQuoteFee: d.readBigUInt64LE(VP.CREATOR_QUOTE_FEE),
  };
}

export async function readConfig(config) {
  const info = await connection.getAccountInfo(new PublicKey(config));
  if (!info) throw new Error(`config not found: ${config}`);
  const d = info.data;
  if (d.length !== 1048) throw new Error(`unexpected PoolConfig size ${d.length}, expected 1048`);
  return {
    size: d.length,
    quoteMint: new PublicKey(d.subarray(8, 40)).toBase58(),
    tokenType: d[8 + 229],
    quoteTokenFlag: d[8 + 230],
    creatorTradingFeePct: d[8 + 237],
  };
}
