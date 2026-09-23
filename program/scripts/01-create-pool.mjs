/* Stand up the demo's collateral: a USDC-quoted DBC pool that pays its creator
   a share of trading fees.

   Float only underwrites pools quoted in USDC, because that is what lets the
   program price a loan without an oracle. Devnet has no USDC we can mint, so
   this creates a 6-decimal test mint that Float controls and uses it as both
   the pool's quote token and the loan currency. The README says so plainly. */

import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  deriveDbcPoolAddress,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { connection, wallet, readState, writeState, send, readPool, readConfig, usd } from "./common.mjs";

const CREATOR_FEE_PCT = 50; // the creator keeps half of trading fees
const QUOTE_DECIMALS = 6;

const payer = wallet();
console.log(`wallet ${payer.publicKey.toBase58()}`);
console.log(`balance ${(await connection.getBalance(payer.publicKey)) / 1e9} SOL\n`);

let state = readState();

/* 1. The quote mint Float lends in and the pool collects fees in. */
if (!state.usdcMint) {
  console.log("creating test USDC mint (6dp)...");
  const mint = await createMint(connection, payer, payer.publicKey, null, QUOTE_DECIMALS);
  state = writeState({ usdcMint: mint.toBase58() });
  console.log(`  mint ${mint.toBase58()}`);
} else {
  console.log(`test USDC mint ${state.usdcMint} (existing)`);
}
const usdcMint = new PublicKey(state.usdcMint);

/* 2. Fund the wallet so it can trade the pool into existence. */
const payerUsdc = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, payer.publicKey);
if (Number(payerUsdc.amount) < 500_000_000_000) {
  console.log("minting 1,000,000 test USDC to wallet...");
  await mintTo(connection, payer, usdcMint, payerUsdc.address, payer, 1_000_000_000_000n);
}
console.log(`payer USDC ata ${payerUsdc.address.toBase58()}\n`);

const client = DynamicBondingCurveClient.create(connection, "confirmed");

/* 3. A config that pays the creator a real share, collected in quote. Those
      two choices are what make the pool lendable: Float's program rejects a
      pool whose creator share is zero, and a quote-collected fee is already
      denominated in the currency of the loan. */
if (!state.dbcConfig) {
  console.log(`creating DBC config (creator fee ${CREATOR_FEE_PCT}%, quote-collected)...`);
  const curve = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.SIX,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 10_000_000,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 200,
          endingFeeBps: 200,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: CREATOR_FEE_PCT,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 10, creatorFeePercentage: 50 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityPercentage: 0,
      // Meteora requires at least 10% permanently locked at day one.
      creatorPermanentLockedLiquidityPercentage: 10,
      creatorLiquidityPercentage: 90,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: 10_000,
    migrationMarketCap: 200_000,
  });

  const configKp = Keypair.generate();
  const tx = await client.partner.createConfig({
    config: configKp.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    payer: payer.publicKey,
    quoteMint: usdcMint,
    ...curve,
  });
  await send(tx, [payer, configKp], "createConfig");
  state = writeState({ dbcConfig: configKp.publicKey.toBase58() });
} else {
  console.log(`DBC config ${state.dbcConfig} (existing)`);
}
const config = new PublicKey(state.dbcConfig);
console.log("config as Float reads it:", await readConfig(config), "\n");

/* 4. The pool itself. Its creator is the borrower wallet, which is exactly
      what the borrower later hands to Float. */
if (!state.pool) {
  console.log("creating pool...");
  const baseKp = Keypair.generate();
  const tx = await client.creator.createPool({
    config,
    baseMint: baseKp.publicKey,
    name: "Float Demo",
    symbol: "FLOATD",
    uri: "https://example.invalid/floatd.json",
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
  });
  await send(tx, [payer, baseKp], "createPool");
  const pool = deriveDbcPoolAddress(usdcMint, baseKp.publicKey, config);
  state = writeState({ baseMint: baseKp.publicKey.toBase58(), pool: pool.toBase58() });
  console.log(`  pool ${pool.toBase58()}`);
} else {
  console.log(`pool ${state.pool} (existing)`);
}

const view = await readPool(state.pool);
console.log("\npool as Float reads it:");
console.log(`  size                     ${view.size} (must be 424)`);
console.log(`  creator                  ${view.creator}`);
console.log(`  config                   ${view.config}`);
console.log(`  hasSwap                  ${view.hasSwap}`);
console.log(`  isMigrated               ${view.isMigrated}`);
console.log(`  totalTradingQuoteFee     ${usd(view.totalTradingQuoteFee)}`);
console.log(`  creatorQuoteFee          ${usd(view.creatorQuoteFee)}`);
