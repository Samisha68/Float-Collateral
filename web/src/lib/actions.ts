/* The things a connected business can actually do.

   Each of these builds a transaction that the borrower's own wallet signs.
   Float never holds a borrower's key, and the verifier key that approves a
   business never touches the browser. The only authority moving around here
   is the pool's creator role, and that moves through Meteora.

   Every call checks what it can before asking for a signature, so a wallet
   prompt means the transaction is expected to succeed. Being asked to sign
   something that then fails is the fastest way to lose someone's trust. */

import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction, getMint,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  program, connection, config, marketPda, vaultPda, poolAuthorityPda,
  verificationPda, recordPda, pledgePda, loanPda, getPool,
  priceFeedPda, tokenVaultPda, tokenCollateralPda,
} from "./chain";

const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const USDC_MINT = new PublicKey(config.usdcMint);

/** Meteora's own PDAs, derived the way its SDK derives them. */
const dbcPda = (seed: string) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], DBC_PROGRAM_ID)[0];
export const dbcPoolAuthority = () => dbcPda("pool_authority");
export const dbcEventAuthority = () => dbcPda("__event_authority");

export type SendFn = (tx: Transaction, connection: Connection) => Promise<string>;

async function confirm(sig: string) {
  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

/** Make sure the borrower has a USDC account before a draw tries to pay into it. */
async function ensureUsdcAccount(owner: PublicKey, tx: Transaction) {
  const ata = await getAssociatedTokenAddress(USDC_MINT, owner);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    tx.add(createAssociatedTokenAccountInstruction(owner, ata, owner, USDC_MINT));
  }
  return ata;
}

/* ── Pledging a pool ─────────────────────────────────────────────────────── */

export type PoolCheck =
  | { ok: true; pool: PublicKey; config: PublicKey; creatorFeePct: number }
  | { ok: false; reason: string };

/** Everything the program will check, checked first so the wallet is only
    asked to sign a pledge that will land. */
export async function checkPool(address: string, owner: PublicKey): Promise<PoolCheck> {
  let pool: PublicKey;
  try {
    pool = new PublicKey(address.trim());
  } catch {
    return { ok: false, reason: "That is not a valid pool address." };
  }

  let view;
  try {
    view = await getPool(pool);
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "Could not read that pool." };
  }
  if (!view) return { ok: false, reason: "No Meteora pool exists at that address on devnet." };

  if (view.creator === poolAuthorityPda().toBase58())
    return { ok: false, reason: "This pool is already pledged to Float." };
  if (view.creator !== owner.toBase58())
    return { ok: false, reason: "Your wallet does not hold this pool's creator role, so it is not yours to pledge." };
  if (view.isMigrated)
    return { ok: false, reason: "This pool has graduated off the bonding curve. Float lends against curve pools only." };
  if (!view.hasSwap)
    return { ok: false, reason: "This pool has never traded, so there is no fee history to underwrite." };

  const cfg = await connection.getAccountInfo(new PublicKey(view.config));
  if (!cfg || cfg.data.length !== 1048)
    return { ok: false, reason: "Could not read this pool's configuration." };
  const quoteMint = new PublicKey(cfg.data.subarray(8, 40)).toBase58();
  const creatorFeePct = cfg.data[8 + 237];

  if (quoteMint !== config.usdcMint)
    return { ok: false, reason: "Float only lends against pools quoted in USDC, because that is what lets it price a loan without an oracle." };
  if (creatorFeePct === 0)
    return { ok: false, reason: "This pool pays its creator no share of trading fees, so there is nothing to lend against." };

  return { ok: true, pool, config: new PublicKey(view.config), creatorFeePct };
}

export async function pledgePool(owner: PublicKey, pool: PublicKey, poolConfig: PublicKey, send: SendFn) {
  const ix = await program.methods
    .pledgePool()
    .accounts({
      borrower: owner,
      market: marketPda(),
      verification: verificationPda(owner),
      virtualPool: pool,
      poolConfig,
      pledge: pledgePda(pool),
      poolAuthority: poolAuthorityPda(),
      dbcEventAuthority: dbcEventAuthority(),
      dbcProgram: DBC_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return confirm(await send(new Transaction().add(ix), connection));
}

/* ── Drawing ─────────────────────────────────────────────────────────────── */

export async function borrow(
  owner: PublicKey, pool: PublicKey, amount: bigint, termDays: number, send: SendFn,
) {
  const tx = new Transaction();
  const borrowerUsdc = await ensureUsdcAccount(owner, tx);
  const ix = await program.methods
    .borrow(new BN(amount.toString()), termDays)
    .accounts({
      borrower: owner,
      market: marketPda(),
      verification: verificationPda(owner),
      record: recordPda(owner),
      virtualPool: pool,
      pledge: pledgePda(pool),
      loan: loanPda(owner),
      poolAuthority: poolAuthorityPda(),
      usdcMint: USDC_MINT,
      usdcVault: vaultPda(),
      borrowerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  tx.add(ix);
  return confirm(await send(tx, connection));
}

/* ── Collecting and repaying ─────────────────────────────────────────────── */

/** Permissionless: anyone may push a borrower's collection forward, and the
    destination is pinned to Float's vault by the program's constraints. */
export async function collectFees(payer: PublicKey, pool: PublicKey, send: SendFn) {
  const view = await getPool(pool);
  if (!view) throw new Error("Pool not found.");
  const baseMint = new PublicKey((await readPoolMints(pool)).baseMint);
  const floatBase = await getAssociatedTokenAddress(baseMint, poolAuthorityPda(), true);

  const tx = new Transaction();
  if (!(await connection.getAccountInfo(floatBase))) {
    tx.add(createAssociatedTokenAccountInstruction(payer, floatBase, poolAuthorityPda(), baseMint));
  }
  const mints = await readPoolMints(pool);
  const ix = await program.methods
    .collectFees()
    .accounts({
      cranker: payer,
      market: marketPda(),
      virtualPool: pool,
      pledge: pledgePda(pool),
      loan: loanPda(new PublicKey(((await (program.account as any).pledgedPool.fetch(pledgePda(pool))) as any).borrower)),
      poolAuthority: poolAuthorityPda(),
      dbcPoolAuthority: dbcPoolAuthority(),
      poolBaseVault: new PublicKey(mints.baseVault),
      poolQuoteVault: new PublicKey(mints.quoteVault),
      baseMint,
      floatBaseAccount: floatBase,
      usdcMint: USDC_MINT,
      usdcVault: vaultPda(),
      tokenBaseProgram: TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      dbcEventAuthority: dbcEventAuthority(),
      dbcProgram: DBC_PROGRAM_ID,
    })
    .instruction();
  tx.add(ix);
  return confirm(await send(tx, connection));
}

export async function repay(owner: PublicKey, send: SendFn) {
  const tx = new Transaction();
  const borrowerUsdc = await ensureUsdcAccount(owner, tx);
  const ix = await program.methods
    .repay()
    .accounts({
      borrower: owner,
      market: marketPda(),
      record: recordPda(owner),
      loan: loanPda(owner),
      usdcMint: USDC_MINT,
      usdcVault: vaultPda(),
      borrowerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  tx.add(ix);
  return confirm(await send(tx, connection));
}

export async function releasePool(owner: PublicKey, pool: PublicKey, send: SendFn) {
  const mints = await readPoolMints(pool);
  const ix = await program.methods
    .releasePool()
    .accounts({
      borrower: owner,
      market: marketPda(),
      virtualPool: pool,
      pledge: pledgePda(pool),
      loan: loanPda(owner),
      poolAuthority: poolAuthorityPda(),
      poolConfig: new PublicKey(mints.config),
      dbcEventAuthority: dbcEventAuthority(),
      dbcProgram: DBC_PROGRAM_ID,
    })
    .instruction();
  return confirm(await send(new Transaction().add(ix), connection));
}

/** The pool fields the CPIs need, read by the same offsets the program uses. */
async function readPoolMints(pool: PublicKey) {
  const info = await connection.getAccountInfo(pool);
  if (!info || info.data.length !== 424) throw new Error("Unexpected Meteora pool layout.");
  const key = (o: number) => new PublicKey(info.data.subarray(o, o + 32)).toBase58();
  return {
    config: key(72),
    baseMint: key(136),
    baseVault: key(168),
    quoteVault: key(200),
  };
}

/** How much USDC the borrower is holding, for the repay screen. */
export async function usdcBalance(owner: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, owner);
    const bal = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}


/* ── The token rail ──────────────────────────────────────────────────────────

   The other kind of collateral. A business that never launched a token still
   holds assets, and Float escrows those instead: it values them at a posted
   price and seizes them if the price stops covering the loan.

   The mint's own program matters here. A Token-2022 mint with a transfer fee
   is the case Float was built for, and its program is not USDC's, so every
   call has to ask which one it is rather than assume. Getting this wrong is
   not a type error; it is a transaction that fails after the wallet has
   already asked someone to sign. */

/** Which token program owns this mint, and how many decimals it has. */
export async function readCollateralMint(mint: PublicKey) {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("No mint exists at that address on devnet.");
  const owner = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID) && !info.owner.equals(TOKEN_PROGRAM_ID))
    throw new Error("That address is not an SPL token mint.");
  const parsed = await getMint(connection, mint, "confirmed", owner);
  return { tokenProgram: owner, decimals: parsed.decimals, supply: parsed.supply };
}

export type MintCheck =
  | { ok: true; mint: PublicKey; decimals: number; tokenProgram: PublicKey; balance: bigint; price: bigint | null }
  | { ok: false; reason: string };

/** Everything the deposit will check, checked first. A price has to exist
    before collateral is worth anything, so this reports its absence plainly
    rather than letting the draw fail later. */
export async function checkCollateralMint(address: string, owner: PublicKey): Promise<MintCheck> {
  let mint: PublicKey;
  try {
    mint = new PublicKey(address.trim());
  } catch {
    return { ok: false, reason: "That is not a valid mint address." };
  }

  let info;
  try {
    info = await readCollateralMint(mint);
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "Could not read that mint." };
  }

  const ata = await getAssociatedTokenAddress(mint, owner, false, info.tokenProgram);
  let balance = 0n;
  try {
    const bal = await connection.getTokenAccountBalance(ata, "confirmed");
    balance = BigInt(bal.value.amount);
  } catch {
    return { ok: false, reason: "Your wallet holds none of this token." };
  }
  if (balance === 0n) return { ok: false, reason: "Your wallet holds none of this token." };

  const feed = await connection.getAccountInfo(priceFeedPda(mint), "confirmed");
  let price: bigint | null = null;
  if (feed) {
    try {
      const decoded: any = program.coder.accounts.decode("priceFeed", feed.data as Buffer);
      price = BigInt(decoded.price.toString());
    } catch { /* an unreadable feed is the same as no feed */ }
  }
  if (price === null)
    return { ok: false, reason: "Float has not posted a price for this token, so it cannot be valued." };

  return { ok: true, mint, decimals: info.decimals, tokenProgram: info.tokenProgram, balance, price };
}

export async function depositTokenCollateral(
  owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey, amount: bigint, send: SendFn,
) {
  const borrowerTokens = await getAssociatedTokenAddress(mint, owner, false, tokenProgram);
  const ix = await program.methods
    .depositTokenCollateral(new BN(amount.toString()))
    .accounts({
      borrower: owner,
      market: marketPda(),
      verification: verificationPda(owner),
      collateralMint: mint,
      position: tokenCollateralPda(owner, mint),
      tokenVault: tokenVaultPda(mint),
      borrowerTokens,
      tokenProgram,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return confirm(await send(new Transaction().add(ix), connection));
}

export async function borrowAgainstTokens(
  owner: PublicKey, mint: PublicKey, amount: bigint, termDays: number, send: SendFn,
) {
  const tx = new Transaction();
  const borrowerUsdc = await ensureUsdcAccount(owner, tx);
  const ix = await program.methods
    .borrowAgainstTokens(new BN(amount.toString()), termDays)
    .accounts({
      borrower: owner,
      market: marketPda(),
      verification: verificationPda(owner),
      record: recordPda(owner),
      collateralMint: mint,
      priceFeed: priceFeedPda(mint),
      position: tokenCollateralPda(owner, mint),
      loan: loanPda(owner),
      usdcMint: USDC_MINT,
      usdcVault: vaultPda(),
      borrowerUsdc,
      // This instruction moves USDC and nothing else, so this is USDC's
      // program, not the collateral's.
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  tx.add(ix);
  return confirm(await send(tx, connection));
}

export async function withdrawTokenCollateral(
  owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey, amount: bigint, send: SendFn,
) {
  const borrowerTokens = await getAssociatedTokenAddress(mint, owner, false, tokenProgram);
  const ix = await program.methods
    .withdrawTokenCollateral(new BN(amount.toString()))
    .accounts({
      borrower: owner,
      market: marketPda(),
      collateralMint: mint,
      position: tokenCollateralPda(owner, mint),
      loan: loanPda(owner),
      tokenVault: tokenVaultPda(mint),
      borrowerTokens,
      tokenProgram,
    })
    .instruction();
  return confirm(await send(new Transaction().add(ix), connection));
}
