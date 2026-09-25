# Float Collateral

**Working capital for businesses, secured by what they already hold.**

> A business can own something valuable and still be short of cash on Friday.

---

## The problem

A project launches a token on Meteora's Dynamic Bonding Curve. Its pool trades, and
the creator earns a share of every trade as fees. That is real revenue, arriving
continuously, verifiable by anyone.

It also arrives slowly. Payroll does not.

The usual answer is to sell something. Float's answer is to lend against the revenue
that is already coming, and to take the claim on it as security.

## What Float does

A verified business posts collateral and draws USDC against it. There are two kinds,
and the kind decides the price.

**A fee stream.** The business hands its pool's **creator role** to Float and draws
against the fees that role earns. While the loan is open, Float collects those fees
straight out of the pool. When the debt clears, the role goes back.

Float never holds the pool's tokens. It holds the authority Meteora requires to claim
the pool's creator fees. That distinction is the whole security model, and it is
enforced by Meteora's program rather than by ours.

**Escrowed tokens.** Not every business launched a token. One that merely holds tokens
moves them into Float's escrow instead, where they are valued at a posted price and
can be seized if that price stops covering the debt.

**Every repayment is recorded, and the record changes the price of the next loan.**

## The two ideas, plainly

Neither is novel on its own. Collateralised lending has been built many times, and
on-chain reputation has been explored before. Float is the combination:

1. **A tokenised revenue stream as business collateral.** Not a position to be
   liquidated, a receivable to be collected. That makes it closer to factoring than
   to margin lending, and it means repayment happens at source rather than on trust.

2. **A repayment record that moves the terms.** Not a score Float invented. A count
   of loans actually settled, held in an account, readable by anyone.

### Two rails, one ladder

A fee stream **cannot be seized**. If the pool stops trading, Float has no asset to
take; its recourse is the record and the borrower's own USDC. So the record has to do
the underwriting, and the rail starts at 150%.

Escrowed tokens **can** be seized. That sounds strictly safer and is not: their price
moves while the loan is open, and a seizure at the wrong moment recovers less than the
screen said the collateral was worth. So the rail starts at 200%.

| | Fee stream | Escrowed tokens |
|---|---|---|
| Can Float seize it? | No | Yes |
| What repays the loan | The fees, at source | The borrower, or a liquidator |
| Needs a price? | No | Yes |
| New business | 150% | 200% |
| After six repayments | 120% | 170% |

Neither asset is safer in the abstract. They fail differently, and the margin is where
that difference is priced. **Collateral quality sets where a borrower starts. The
record is the only thing that moves them.**

### The constraint that matters

A record improves the **price** of credit. It never increases **how much** a business
may borrow.

| | New business | Proven business |
|---|---|---|
| Approved credit | $10,000 | $10,000 |
| Successful repayments | 0 | 6 |
| Collateral requirement | 150% | 120% |
| Fee, 30 days | 1.8% | 1.2% |
| **Coverage for a $5,000 draw** | **$7,500** | **$6,000** |

Same limit. Different history. Different terms.

This is not a convention the code politely observes. The approved limit lives on
`BusinessVerification`, which only the verifier may write, and the record lives on
`BusinessRecord`, which only the credit instructions may write. No credit instruction
can reach the limit. Every project that let reputation lower collateralisation below
100% has failed, so reputation here is not allowed near that lever at all.

## How it works

```
verify     a business is approved and given a limit
   |
pledge     the creator role moves to Float, in one transaction Meteora enforces
   |
observe    Float watches the pool trade before it will project a run rate
   |
draw       USDC out, sized by the projection at the tier the record has earned
   |
collect    Float claims the pool's creator fees into its vault
   |
repay      the business covers whatever the stream did not
   |
release    the creator role goes home, and the record gains one
```

The important moment is not the first loan. It is the second one being cheaper.

## Why the pledge is a lock and not a promise

After a pledge, the business calls Meteora's `claim_creator_trading_fee` on its own
pool. Meteora refuses, and the accrued fees are untouched afterwards.

That is a test in this repository, not a claim in a deck. Run
`node scripts/04-prove-locked.mjs` and watch it fail on purpose.

## Why Solana

The collateral, the settlement and the record are the same programmable system.

The fee stream is a program-controlled authority, so assigning it is a transaction
rather than a contract. USDC settles beside it. The repayment record is state that
the next lender can read without asking anyone's permission, and it travels with the
business rather than with Float.

## One rail needs a price. The other does not.

Float underwrites pools quoted in USDC, and nothing else. On the fee-stream rail the
income accrues in the same unit as the debt, so there is no price to fetch, no feed to
trust and no staleness to handle. A SOL-quoted pool would need all three, which is why
v1 declines them.

Escrowed tokens are the opposite. They have to be valued, and the valuation has to be
current, so that rail carries a price feed — one **Float itself publishes**, with a
five-minute staleness limit the program enforces on every draw and every seizure.

That is a real trust assumption and not a small one: on this rail Float is the oracle.
A deployment that mattered would read Pyth or Switchboard here. It is named as a limit
below rather than left for a reader to notice.

On the fee-stream rail, borrowing power comes from observed accrual instead:

```
observed_gross    = pool.total_trading_quote_fee - baseline_at_pledge
creator_share     = observed_gross * creator_trading_fee_percentage / 100
horizon           = min(term, observation_window * max_extrapolation_ratio)
projected         = creator_share * horizon / observation_window

require: projected * 10_000 >= draw * margin_bps
```

The cap matters. Straight-line extrapolation flatters a short window badly: an hour of
wash trading would otherwise project a month of it. Borrowing power reaches no further
than a fixed multiple of the window actually observed, so buying a run rate costs about
as much as sustaining one.

All of it is integer arithmetic with `u128` intermediates. No floating point touches
money anywhere in the program.

## Signing in

A business does not necessarily have a browser extension holding a Solana keypair, and
requiring one turns "apply for credit" into "install software first". So there are two
ways in:

- **Email or Google.** Privy provisions an embedded Solana wallet the user controls.
- **A browser wallet.** Anything speaking the Wallet Standard.

They are not two code paths. Privy's embedded wallet implements the Wallet Standard, so
it is registered into the same registry the adapter already reads, and every screen,
action and `useWallet()` call downstream is identical either way. The chain cannot tell
which route a signature came from.

Privy needs an app ID, which `.env.example` documents. Without one Float still works and
simply asks for a browser wallet, as it did before.

## Honesty

Judges forgive a prototype's limits. They do not forgive a prototype that hides them.

- **Devnet only.** No mainnet transaction has ever been signed by this project. No real
  funds move, and no financing is promised.
- **The USDC is a test mint that Float controls.** Devnet has no mintable USDC, and the
  pool's quote token has to be the same asset the loan is denominated in.
- **The pool is one we launched.** It is a real Meteora DBC pool doing real trades, but
  it belongs to the demo, not to a real business.
- **Verification is performed by Float's own key.** It is an authority check, not a
  compliance system, and there is no KYB provider behind it.
- **The run rate is a forecast.** Capped and computed from observed trading, but a
  forecast. If a pool's volume dies, the fees will not cover the loan and the business
  repays the difference.
- **Collateral prices are relayed, not oracular.** Float's own key posts them. The
  program enforces staleness and an authorised publisher; it cannot enforce honesty.
- **The test collateral token is not an asset.** The app will mint you one so the token
  rail can be walked end to end. It is a devnet token with no value.
- **A fee stream cannot be liquidated.** There is nothing liquid to seize, so on that
  rail Float keeps collecting until the debt clears.
- **Token liquidation has no keeper and no seizure discount.** Anyone may settle an
  uncovered loan and take the escrow, and the incentive to do it is whatever the price
  gap happens to leave them. Nobody is paid to watch. If a price gaps straight through
  100% coverage, the loss is Float's. A production design needs both; neither is built.
- **One collateral at a time.** A business posts a fee stream or tokens, not both.
- **Only tokens Float has priced.** There is no oracle to look up an arbitrary mint, so the
  token rail accepts the mints Float has listed and says so rather than failing later.
- **History is reconstructed from events.** A borrower's past advances are read from the
  program's transaction log, which devnet rate-limits. When the lookup comes back short the
  app says so instead of showing a partial history as though it were the whole one.

What is not a stand-in: the program, the Meteora integration, the pledge, the
collection, and every repayment in the record. Those are all real transactions on
devnet and can be read back from the chain.

## What is in this repository

| Path | What it is |
|---|---|
| `program/programs/float_credit/src/lib.rs` | The Solana program. Anchor 0.31.1. Fifteen instructions over seven accounts. |
| `program/programs/float_credit/src/dbc.rs` | Meteora interop. Reads pool state by verified byte offset and calls two instructions by CPI, with no dependency on Meteora's crate. |
| `program/programs/float_credit/src/pricing.rs` | The margin ladder and the fee curve, with the unit tests that pin them. |
| `program/scripts/` | Devnet setup, both loops, the security proof, the liquidation proof and the borrower seeding. |
| `program/build.sh` | Build wrapper that fails on a BPF stack overflow. See below. |
| `web/` | The borrower application. Vite, React, TypeScript. Reads devnet directly. |

## On chain

Program **`EmadJs2c9bZKoncD2cirBGn7qdNWbFqaeYqPrM5LkG1f`**, deployed on **devnet**.

Meteora's Dynamic Bonding Curve is `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`,
which is the same address on devnet and mainnet.

`dbc.rs` reads Meteora's accounts by byte offset rather than deserialising their
structs. Every offset was checked against live mainnet accounts before it was written
down, and the reader re-checks the discriminator and the account length on every read,
so a Meteora upgrade that moves a field fails loudly instead of mispricing a loan.

## Running it

```bash
# Program
cd program
./build.sh                       # anchor build, and fail on a stack overflow
cargo test -p float_credit --lib # the pricing and projection tests
anchor deploy --provider.cluster devnet

# Devnet demo, in order
node scripts/01-create-pool.mjs      # test USDC mint, DBC config, pool
node scripts/02-trade.mjs            # trade it so it has a fee history
node scripts/03-pledge.mjs           # init the market, verify, pledge
node scripts/04-prove-locked.mjs     # the borrower tries to claim, and cannot
node scripts/05-loop.mjs             # borrow, collect, repay, release
node scripts/06-seed-borrower-b.mjs  # six real repayment cycles
node scripts/07-comparison.mjs       # the comparison, read back from chain
node scripts/08-new-user.mjs         # a stranger's whole journey, fee-stream rail

# The token rail. Needs the verifier running: npm --prefix ../web run verifier
node scripts/10-token-rail.mjs       # price, escrow, draw, lock, repay, release
node scripts/11-liquidate.mjs        # a healthy position held, an uncovered one seized

# Application
cd web && npm install
npm test          # the pricing ladder, cross-checked against pricing.rs
npm run dev
```

Set `VITE_RPC_URL` to a dedicated endpoint before demonstrating. The public devnet
endpoint rate-limits hard enough to break a live walkthrough.

### A note on green builds

`cargo build-sbf` reports a BPF stack overflow on a line beginning `Error: Function`,
then exits zero and writes a `.so` anyway. The program it produces has undefined
behaviour. Ours read a `bool` out of a corrupted stack frame and rejected every draw
with the wrong error until the warning was read rather than the exit code.

`./build.sh` exists because of that afternoon. Use it instead of `anchor build`.

## Built with

Solana, Anchor 0.31.1, and Meteora's Dynamic Bonding Curve.

## Licence

MIT. See `LICENSE`.
