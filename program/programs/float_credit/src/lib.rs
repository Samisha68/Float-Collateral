/* Float — working capital against an assigned Meteora DBC creator fee stream.

   A project that launched a token on Meteora's Dynamic Bonding Curve earns
   trading fees as its pool trades. Those fees arrive slowly. Payroll does not.
   Float lends USDC against that stream and takes the pool's creator role as
   security, so the fees repay the loan at source rather than on trust.

   Three layers, kept deliberately separate:

     identity    BusinessVerification   who is borrowing, and their limit
     collateral  PledgedPool            which fee stream secures it
     reputation  BusinessRecord         how Float prices the relationship

   The separation is enforced by account boundaries, not convention. A
   borrower's approved credit limit lives on BusinessVerification, which only
   the verifier may write. No credit instruction can reach it. So "a repayment
   record improves your terms but never your exposure" is a property of the
   program, not a promise in a README. */

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod dbc;
pub mod pricing;

use dbc::{ConfigView, PoolView};

declare_id!("EmadJs2c9bZKoncD2cirBGn7qdNWbFqaeYqPrM5LkG1f");

pub const MARKET_SEED: &[u8] = b"market";
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
pub const USDC_VAULT_SEED: &[u8] = b"usdc_vault";
pub const VERIFICATION_SEED: &[u8] = b"verification";
pub const RECORD_SEED: &[u8] = b"record";
pub const PLEDGE_SEED: &[u8] = b"pledge";
pub const LOAN_SEED: &[u8] = b"loan";

/// Shortest term Float will write, in days.
pub const MIN_TERM_DAYS: u32 = 1;
/// Longest term Float will write, in days. Matches Float's existing product.
pub const MAX_TERM_DAYS: u32 = 60;
/// A pool must trade under Float's observation for at least this long before
/// Float will lend against its run rate. Underwriting, not ceremony: without a
/// window there is no observed accrual to project from.
pub const DEFAULT_OBSERVATION_SECS: i64 = 3_600;

#[program]
pub mod float_credit {
    use super::*;

    /// Stand up the market. Admin holds configuration; the verifier approves
    /// businesses; the USDC vault funds advances and receives repayments.
    pub fn init_market(ctx: Context<InitMarket>, observation_secs: i64) -> Result<()> {
        require!(observation_secs > 0, FloatError::InvalidObservationWindow);
        let market = &mut ctx.accounts.market;
        market.admin = ctx.accounts.admin.key();
        market.verifier = ctx.accounts.admin.key();
        market.usdc_mint = ctx.accounts.usdc_mint.key();
        market.usdc_vault = ctx.accounts.usdc_vault.key();
        market.observation_secs = observation_secs;
        market.advances_funded = 0;
        market.principal_outstanding = 0;
        market.bump = ctx.bumps.market;
        market.pool_authority_bump = ctx.bumps.pool_authority;
        emit!(MarketInitialized {
            admin: market.admin,
            usdc_mint: market.usdc_mint,
            observation_secs,
        });
        Ok(())
    }

    /// Move the verifier role. Admin only.
    pub fn set_verifier(ctx: Context<SetVerifier>, new_verifier: Pubkey) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let previous = market.verifier;
        market.verifier = new_verifier;
        emit!(VerifierChanged { previous, current: new_verifier });
        Ok(())
    }

    /// Approve a business and set its exposure. `kyb_reference` is a hash of
    /// the off-chain evidence bundle; the documents themselves never touch the
    /// chain. For the hackathon the verifier is Float's own key, which the
    /// README states plainly.
    pub fn verify_business(
        ctx: Context<VerifyBusiness>,
        kyb_reference: [u8; 32],
        credit_limit: u64,
    ) -> Result<()> {
        require!(credit_limit > 0, FloatError::InvalidCreditLimit);
        let clock = Clock::get()?;

        let v = &mut ctx.accounts.verification;
        v.authority = ctx.accounts.borrower.key();
        v.verified = true;
        v.verifier = ctx.accounts.verifier.key();
        v.verified_at = clock.unix_timestamp;
        v.verification_version = v.verification_version.saturating_add(1);
        v.kyb_reference = kyb_reference;
        v.credit_limit = credit_limit;
        v.bump = ctx.bumps.verification;

        let record = &mut ctx.accounts.record;
        if record.authority == Pubkey::default() {
            record.authority = ctx.accounts.borrower.key();
            record.bump = ctx.bumps.record;
        }

        emit!(BusinessVerified {
            business: v.authority,
            verifier: v.verifier,
            credit_limit,
            verification_version: v.verification_version,
        });
        Ok(())
    }

    /// Pledge a DBC pool by handing its creator role to Float.
    ///
    /// The borrower signs, and this instruction calls Meteora's
    /// `transfer_pool_creator` inside the same transaction, so the pledge is
    /// atomic: either Float records the pledge and holds the role, or neither
    /// happened. After this returns, the borrower cannot claim the pool's
    /// creator fees. Only Float's pool-authority PDA can.
    pub fn pledge_pool(ctx: Context<PledgePool>) -> Result<()> {
        let clock = Clock::get()?;
        let pool = PoolView::load(&ctx.accounts.virtual_pool)?;
        let config = ConfigView::load(&ctx.accounts.pool_config)?;

        require_keys_eq!(pool.config, ctx.accounts.pool_config.key(), FloatError::PoolConfigMismatch);
        require_keys_eq!(
            pool.creator,
            ctx.accounts.borrower.key(),
            FloatError::BorrowerDoesNotOwnPool
        );
        require!(!pool.is_migrated, FloatError::PoolAlreadyMigrated);
        require!(pool.has_swap, FloatError::PoolHasNeverTraded);
        require!(config.creator_trading_fee_pct > 0, FloatError::PoolPaysCreatorNothing);
        // Fees accrue in the pool's quote token. Float lends USDC, so it only
        // underwrites USDC-quoted pools; anything else would need a price feed
        // and this program deliberately has none.
        require_keys_eq!(
            config.quote_mint,
            ctx.accounts.market.usdc_mint,
            FloatError::PoolNotQuotedInUsdc
        );

        dbc::transfer_pool_creator(
            &ctx.accounts.dbc_program,
            &ctx.accounts.virtual_pool,
            &ctx.accounts.pool_config,
            &ctx.accounts.borrower.to_account_info(),
            &ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.dbc_event_authority,
            &[],
        )?;

        // Re-read: trust Meteora's post-state, not our expectation of it.
        let after = PoolView::load(&ctx.accounts.virtual_pool)?;
        require_keys_eq!(
            after.creator,
            ctx.accounts.pool_authority.key(),
            FloatError::CreatorTransferDidNotStick
        );

        let pledge = &mut ctx.accounts.pledge;
        pledge.borrower = ctx.accounts.borrower.key();
        pledge.pool = ctx.accounts.virtual_pool.key();
        pledge.config = ctx.accounts.pool_config.key();
        pledge.creator_fee_pct = config.creator_trading_fee_pct;
        pledge.baseline_trading_quote_fee = after.total_trading_quote_fee;
        pledge.pledged_at = clock.unix_timestamp;
        pledge.released = false;
        pledge.bump = ctx.bumps.pledge;

        emit!(PoolPledged {
            business: pledge.borrower,
            pool: pledge.pool,
            creator_fee_pct: pledge.creator_fee_pct,
            baseline_trading_quote_fee: pledge.baseline_trading_quote_fee,
            pledged_at: pledge.pledged_at,
        });
        Ok(())
    }

    /// Draw USDC against the pledged pool's observed fee run rate.
    ///
    /// Two independent gates, and both must pass:
    ///   1. principal must fit inside the approved credit limit, which the
    ///      repayment record cannot move
    ///   2. fees projected over the term must cover the principal at the
    ///      margin the record has earned
    pub fn borrow(ctx: Context<Borrow>, amount: u64, term_days: u32) -> Result<()> {
        require!(amount > 0, FloatError::AmountMustBePositive);
        require!(
            (MIN_TERM_DAYS..=MAX_TERM_DAYS).contains(&term_days),
            FloatError::TermOutOfRange
        );
        require!(ctx.accounts.verification.verified, FloatError::BusinessNotVerified);

        let clock = Clock::get()?;
        let loan = &mut ctx.accounts.loan;
        require!(loan.status != LoanStatus::Active, FloatError::LoanAlreadyActive);

        let pledge = &ctx.accounts.pledge;
        require!(!pledge.released, FloatError::PledgeReleased);

        let pool = PoolView::load(&ctx.accounts.virtual_pool)?;
        require_keys_eq!(
            pool.creator,
            ctx.accounts.pool_authority.key(),
            FloatError::FloatNoLongerHoldsCreatorRole
        );
        require!(!pool.is_migrated, FloatError::PoolAlreadyMigrated);

        // Reputation sets the price, never the exposure.
        let repayments = ctx.accounts.record.advances_repaid;
        let margin_bps = pricing::margin_bps(repayments);
        let fee = pricing::fee_amount(amount, term_days, repayments)
            .ok_or(FloatError::MathOverflow)?;
        let total_due = amount.checked_add(fee).ok_or(FloatError::MathOverflow)?;

        // Gate 1: the approved limit.
        require!(
            amount <= ctx.accounts.verification.credit_limit,
            FloatError::ExceedsApprovedCredit
        );

        // Gate 2: projected coverage at this borrower's margin.
        let elapsed = clock
            .unix_timestamp
            .checked_sub(pledge.pledged_at)
            .ok_or(FloatError::MathOverflow)?;
        require!(
            elapsed >= ctx.accounts.market.observation_secs,
            FloatError::ObservationWindowNotElapsed
        );
        let observed_gross = pool
            .total_trading_quote_fee
            .checked_sub(pledge.baseline_trading_quote_fee)
            .ok_or(FloatError::PoolFeeCounterWentBackwards)?;
        let projected = project_creator_fees(
            observed_gross,
            pledge.creator_fee_pct,
            elapsed,
            term_days,
        )
        .ok_or(FloatError::MathOverflow)?;
        let required = (amount as u128)
            .checked_mul(margin_bps as u128)
            .ok_or(FloatError::MathOverflow)?
            .div_ceil(10_000u128);
        require!(
            (projected as u128) >= required,
            FloatError::InsufficientProjectedFees
        );

        // Disburse.
        let market_bump = ctx.accounts.market.bump;
        let seeds: &[&[u8]] = &[MARKET_SEED, &[market_bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.usdc_vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.borrower_usdc.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.usdc_mint.decimals,
        )?;

        loan.borrower = ctx.accounts.borrower.key();
        loan.pool = pledge.pool;
        loan.principal = amount;
        loan.fee = fee;
        loan.total_due = total_due;
        loan.collected = 0;
        loan.margin_bps = margin_bps as u16;
        loan.term_days = term_days as u16;
        loan.projected_at_draw = projected;
        loan.repayments_at_draw = repayments;
        loan.drawn_at = clock.unix_timestamp;
        loan.due_at = clock.unix_timestamp + (term_days as i64) * 86_400;
        loan.nonce = loan.nonce.saturating_add(1);
        loan.status = LoanStatus::Active;
        loan.bump = ctx.bumps.loan;

        let record = &mut ctx.accounts.record;
        record.advances_taken = record.advances_taken.saturating_add(1);

        let market = &mut ctx.accounts.market;
        market.advances_funded = market.advances_funded.saturating_add(1);
        market.principal_outstanding = market.principal_outstanding.saturating_add(amount);

        emit!(Drawn {
            business: loan.borrower,
            pool: loan.pool,
            nonce: loan.nonce,
            principal: amount,
            fee,
            total_due,
            margin_bps: loan.margin_bps,
            term_days: loan.term_days,
            projected_fees: projected,
            repayments_at_draw: repayments,
            due_at: loan.due_at,
        });
        Ok(())
    }

    /// Sweep the pool's accrued creator fees into Float's vault against the
    /// live loan. Permissionless on purpose: anyone may push a borrower's
    /// collection forward, nobody may divert it, because the destination is
    /// fixed to Float's vault by the account constraints.
    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        let loan = &ctx.accounts.loan;
        require!(loan.status == LoanStatus::Active, FloatError::NoActiveLoan);

        let before = ctx.accounts.usdc_vault.amount;

        let bump = ctx.accounts.market.pool_authority_bump;
        let seeds: &[&[u8]] = &[POOL_AUTHORITY_SEED, &[bump]];
        dbc::claim_creator_trading_fee(
            &ctx.accounts.dbc_program,
            &ctx.accounts.dbc_pool_authority,
            &ctx.accounts.virtual_pool,
            &ctx.accounts.float_base_account,
            &ctx.accounts.usdc_vault.to_account_info(),
            &ctx.accounts.pool_base_vault,
            &ctx.accounts.pool_quote_vault,
            &ctx.accounts.base_mint,
            &ctx.accounts.usdc_mint.to_account_info(),
            &ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_base_program,
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.dbc_event_authority,
            u64::MAX,
            u64::MAX,
            &[seeds],
        )?;

        // Credit what actually landed, never what we asked for. The quote
        // token may carry a transfer fee, in which case the vault receives
        // less than the pool released; only the delta is real.
        ctx.accounts.usdc_vault.reload()?;
        let received = ctx
            .accounts
            .usdc_vault
            .amount
            .checked_sub(before)
            .ok_or(FloatError::VaultBalanceWentBackwards)?;

        let loan = &mut ctx.accounts.loan;
        loan.collected = loan.collected.saturating_add(received);

        emit!(FeesCollected {
            business: loan.borrower,
            pool: loan.pool,
            nonce: loan.nonce,
            received,
            collected_total: loan.collected,
            total_due: loan.total_due,
        });
        Ok(())
    }

    /// Settle the loan. Collected fees count first; the borrower tops up
    /// whatever the stream did not cover. A loan settled after its due date
    /// still settles, and is recorded as having been late.
    pub fn repay(ctx: Context<Repay>) -> Result<()> {
        let clock = Clock::get()?;
        let loan = &ctx.accounts.loan;
        require!(loan.status == LoanStatus::Active, FloatError::NoActiveLoan);

        let shortfall = loan.total_due.saturating_sub(loan.collected);
        if shortfall > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.borrower_usdc.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.usdc_vault.to_account_info(),
                        authority: ctx.accounts.borrower.to_account_info(),
                    },
                ),
                shortfall,
                ctx.accounts.usdc_mint.decimals,
            )?;
        }

        let was_late = clock.unix_timestamp > ctx.accounts.loan.due_at;
        let loan = &mut ctx.accounts.loan;
        loan.status = LoanStatus::Repaid;

        let record = &mut ctx.accounts.record;
        record.advances_repaid = record.advances_repaid.saturating_add(1);
        record.total_volume_repaid = record.total_volume_repaid.saturating_add(loan.total_due);
        if was_late {
            record.advances_overdue = record.advances_overdue.saturating_add(1);
        }

        let market = &mut ctx.accounts.market;
        market.principal_outstanding = market.principal_outstanding.saturating_sub(loan.principal);

        emit!(Repaid {
            business: loan.borrower,
            pool: loan.pool,
            nonce: loan.nonce,
            total_due: loan.total_due,
            covered_by_fees: loan.collected.min(loan.total_due),
            topped_up: shortfall,
            was_late,
            advances_repaid: record.advances_repaid,
            total_volume_repaid: record.total_volume_repaid,
            next_margin_bps: pricing::margin_bps(record.advances_repaid) as u16,
        });
        Ok(())
    }

    /// Hand the pool's creator role back. Only once nothing is owed.
    pub fn release_pool(ctx: Context<ReleasePool>) -> Result<()> {
        require!(
            ctx.accounts.loan.status != LoanStatus::Active,
            FloatError::LoanStillActive
        );

        let bump = ctx.accounts.market.pool_authority_bump;
        let seeds: &[&[u8]] = &[POOL_AUTHORITY_SEED, &[bump]];
        dbc::transfer_pool_creator(
            &ctx.accounts.dbc_program,
            &ctx.accounts.virtual_pool,
            &ctx.accounts.pool_config,
            &ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.borrower.to_account_info(),
            &ctx.accounts.dbc_event_authority,
            &[seeds],
        )?;

        let after = PoolView::load(&ctx.accounts.virtual_pool)?;
        require_keys_eq!(
            after.creator,
            ctx.accounts.borrower.key(),
            FloatError::CreatorTransferDidNotStick
        );

        let pledge = &mut ctx.accounts.pledge;
        pledge.released = true;

        emit!(PoolReleased {
            business: pledge.borrower,
            pool: pledge.pool,
        });
        Ok(())
    }
}

/// Project creator fees over a term from accrual observed since the pledge.
///
/// `observed_gross` is the pool's total trading fee accrued during the
/// observation window; the creator's share of it is `creator_pct` percent.
/// Everything is u128 until the final narrowing, because a busy pool's fee
/// counter times a 60-day term in seconds overflows u64 comfortably.
pub fn project_creator_fees(
    observed_gross: u64,
    creator_pct: u8,
    elapsed_secs: i64,
    term_days: u32,
) -> Option<u64> {
    if elapsed_secs <= 0 || creator_pct == 0 {
        return None;
    }
    let creator_share = (observed_gross as u128)
        .checked_mul(creator_pct as u128)?
        .checked_div(100)?;
    let term_secs = (term_days as u128).checked_mul(86_400)?;
    let projected = creator_share
        .checked_mul(term_secs)?
        .checked_div(elapsed_secs as u128)?;
    u64::try_from(projected).ok()
}

// ─────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = Market::LEN,
        seeds = [MARKET_SEED],
        bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: PDA that holds pledged pools' creator role. Never carries data.
    #[account(seeds = [POOL_AUTHORITY_SEED], bump)]
    pub pool_authority: UncheckedAccount<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = market,
        token::token_program = token_program,
        seeds = [USDC_VAULT_SEED],
        bump
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetVerifier<'info> {
    #[account(address = market.admin @ FloatError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct VerifyBusiness<'info> {
    #[account(mut, address = market.verifier @ FloatError::Unauthorized)]
    pub verifier: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: the business being approved; identified by key only.
    pub borrower: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = verifier,
        space = BusinessVerification::LEN,
        seeds = [VERIFICATION_SEED, borrower.key().as_ref()],
        bump
    )]
    pub verification: Account<'info, BusinessVerification>,
    #[account(
        init_if_needed,
        payer = verifier,
        space = BusinessRecord::LEN,
        seeds = [RECORD_SEED, borrower.key().as_ref()],
        bump
    )]
    pub record: Account<'info, BusinessRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PledgePool<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        seeds = [VERIFICATION_SEED, borrower.key().as_ref()],
        bump = verification.bump,
        constraint = verification.verified @ FloatError::BusinessNotVerified
    )]
    pub verification: Account<'info, BusinessVerification>,
    #[account(
        init,
        payer = borrower,
        space = PledgedPool::LEN,
        seeds = [PLEDGE_SEED, virtual_pool.key().as_ref()],
        bump
    )]
    pub pledge: Account<'info, PledgedPool>,
    /// CHECK: PDA that receives the creator role. Validated by seeds.
    #[account(seeds = [POOL_AUTHORITY_SEED], bump = market.pool_authority_bump)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: Meteora VirtualPool. Layout and owner checked in PoolView::load.
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,
    /// CHECK: Meteora PoolConfig. Layout and owner checked in ConfigView::load.
    pub pool_config: UncheckedAccount<'info>,
    /// CHECK: Meteora's event authority PDA.
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: the Meteora program itself.
    #[account(address = dbc::DBC_PROGRAM_ID @ FloatError::WrongDbcProgram)]
    pub dbc_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        seeds = [VERIFICATION_SEED, borrower.key().as_ref()],
        bump = verification.bump
    )]
    pub verification: Account<'info, BusinessVerification>,
    #[account(
        mut,
        seeds = [RECORD_SEED, borrower.key().as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, BusinessRecord>,
    #[account(
        seeds = [PLEDGE_SEED, virtual_pool.key().as_ref()],
        bump = pledge.bump,
        constraint = pledge.borrower == borrower.key() @ FloatError::PledgeNotYours
    )]
    pub pledge: Account<'info, PledgedPool>,
    #[account(
        init_if_needed,
        payer = borrower,
        space = Loan::LEN,
        seeds = [LOAN_SEED, borrower.key().as_ref()],
        bump
    )]
    pub loan: Account<'info, Loan>,
    /// CHECK: PDA holding the creator role. Validated by seeds.
    #[account(seeds = [POOL_AUTHORITY_SEED], bump = market.pool_authority_bump)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: Meteora VirtualPool. Layout and owner checked in PoolView::load.
    pub virtual_pool: UncheckedAccount<'info>,
    #[account(address = market.usdc_mint @ FloatError::WrongMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [USDC_VAULT_SEED], bump)]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = borrower_usdc.mint == market.usdc_mint @ FloatError::WrongMint,
        constraint = borrower_usdc.owner == borrower.key() @ FloatError::WrongTokenOwner
    )]
    pub borrower_usdc: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    /// Anyone may push collection forward.
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        seeds = [PLEDGE_SEED, virtual_pool.key().as_ref()],
        bump = pledge.bump
    )]
    pub pledge: Account<'info, PledgedPool>,
    #[account(
        mut,
        seeds = [LOAN_SEED, pledge.borrower.as_ref()],
        bump = loan.bump
    )]
    pub loan: Account<'info, Loan>,
    /// CHECK: PDA holding the creator role. Validated by seeds.
    #[account(seeds = [POOL_AUTHORITY_SEED], bump = market.pool_authority_bump)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: Meteora VirtualPool. Layout and owner checked in PoolView::load.
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,
    /// CHECK: Meteora's internal pool authority PDA.
    pub dbc_pool_authority: UncheckedAccount<'info>,
    /// CHECK: pool's base token vault, supplied by Meteora's layout.
    #[account(mut)]
    pub pool_base_vault: UncheckedAccount<'info>,
    /// CHECK: pool's quote token vault, supplied by Meteora's layout.
    #[account(mut)]
    pub pool_quote_vault: UncheckedAccount<'info>,
    /// CHECK: pool's base mint.
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: Float's base-token account; receives any base-side creator fee.
    #[account(mut)]
    pub float_base_account: UncheckedAccount<'info>,
    #[account(address = market.usdc_mint @ FloatError::WrongMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [USDC_VAULT_SEED], bump)]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: token program owning the base mint.
    pub token_base_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: Meteora's event authority PDA.
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: the Meteora program itself.
    #[account(address = dbc::DBC_PROGRAM_ID @ FloatError::WrongDbcProgram)]
    pub dbc_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [RECORD_SEED, borrower.key().as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, BusinessRecord>,
    #[account(
        mut,
        seeds = [LOAN_SEED, borrower.key().as_ref()],
        bump = loan.bump,
        constraint = loan.borrower == borrower.key() @ FloatError::LoanNotYours
    )]
    pub loan: Account<'info, Loan>,
    #[account(address = market.usdc_mint @ FloatError::WrongMint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [USDC_VAULT_SEED], bump)]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = borrower_usdc.mint == market.usdc_mint @ FloatError::WrongMint,
        constraint = borrower_usdc.owner == borrower.key() @ FloatError::WrongTokenOwner
    )]
    pub borrower_usdc: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ReleasePool<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [PLEDGE_SEED, virtual_pool.key().as_ref()],
        bump = pledge.bump,
        constraint = pledge.borrower == borrower.key() @ FloatError::PledgeNotYours
    )]
    pub pledge: Account<'info, PledgedPool>,
    #[account(
        seeds = [LOAN_SEED, borrower.key().as_ref()],
        bump = loan.bump
    )]
    pub loan: Account<'info, Loan>,
    /// CHECK: PDA holding the creator role. Validated by seeds.
    #[account(seeds = [POOL_AUTHORITY_SEED], bump = market.pool_authority_bump)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: Meteora VirtualPool. Layout and owner checked in PoolView::load.
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,
    /// CHECK: Meteora PoolConfig.
    pub pool_config: UncheckedAccount<'info>,
    /// CHECK: Meteora's event authority PDA.
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: the Meteora program itself.
    #[account(address = dbc::DBC_PROGRAM_ID @ FloatError::WrongDbcProgram)]
    pub dbc_program: UncheckedAccount<'info>,
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

#[account]
pub struct Market {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_vault: Pubkey,
    pub observation_secs: i64,
    pub advances_funded: u64,
    pub principal_outstanding: u64,
    pub bump: u8,
    pub pool_authority_bump: u8,
}
impl Market {
    pub const LEN: usize = 8 + 32 * 4 + 8 + 8 + 8 + 1 + 1;
}

/// Identity. Only the verifier writes here, which is what keeps the credit
/// limit out of reach of every credit instruction.
#[account]
pub struct BusinessVerification {
    pub authority: Pubkey,
    pub verified: bool,
    pub verifier: Pubkey,
    pub verified_at: i64,
    pub verification_version: u16,
    pub kyb_reference: [u8; 32],
    pub credit_limit: u64,
    pub bump: u8,
}
impl BusinessVerification {
    pub const LEN: usize = 8 + 32 + 1 + 32 + 8 + 2 + 32 + 8 + 1;
}

/// Reputation. A count of what happened, never a score Float invented.
/// Field names match Float's existing `BusinessProfile` so one business keeps
/// one repayment history across Float's credit products.
#[account]
pub struct BusinessRecord {
    pub authority: Pubkey,
    pub advances_taken: u32,
    pub advances_repaid: u32,
    pub advances_overdue: u32,
    pub total_volume_repaid: u64,
    pub bump: u8,
}
impl BusinessRecord {
    pub const LEN: usize = 8 + 32 + 4 + 4 + 4 + 8 + 1;
}

/// Collateral. The pool whose creator role Float is holding.
#[account]
pub struct PledgedPool {
    pub borrower: Pubkey,
    pub pool: Pubkey,
    pub config: Pubkey,
    pub creator_fee_pct: u8,
    pub baseline_trading_quote_fee: u64,
    pub pledged_at: i64,
    pub released: bool,
    pub bump: u8,
}
impl PledgedPool {
    pub const LEN: usize = 8 + 32 * 3 + 1 + 8 + 8 + 1 + 1;
}

#[account]
pub struct Loan {
    pub borrower: Pubkey,
    pub pool: Pubkey,
    pub principal: u64,
    pub fee: u64,
    pub total_due: u64,
    pub collected: u64,
    pub margin_bps: u16,
    pub term_days: u16,
    pub projected_at_draw: u64,
    pub repayments_at_draw: u32,
    pub drawn_at: i64,
    pub due_at: i64,
    pub nonce: u64,
    pub status: LoanStatus,
    pub bump: u8,
}
impl Loan {
    pub const LEN: usize = 8 + 32 + 32 + 8 * 4 + 2 + 2 + 8 + 4 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum LoanStatus {
    #[default]
    Idle,
    Active,
    Repaid,
    Defaulted,
}

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

#[event]
pub struct MarketInitialized {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub observation_secs: i64,
}

#[event]
pub struct VerifierChanged {
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct BusinessVerified {
    pub business: Pubkey,
    pub verifier: Pubkey,
    pub credit_limit: u64,
    pub verification_version: u16,
}

#[event]
pub struct PoolPledged {
    pub business: Pubkey,
    pub pool: Pubkey,
    pub creator_fee_pct: u8,
    pub baseline_trading_quote_fee: u64,
    pub pledged_at: i64,
}

#[event]
pub struct Drawn {
    pub business: Pubkey,
    pub pool: Pubkey,
    pub nonce: u64,
    pub principal: u64,
    pub fee: u64,
    pub total_due: u64,
    pub margin_bps: u16,
    pub term_days: u16,
    pub projected_fees: u64,
    pub repayments_at_draw: u32,
    pub due_at: i64,
}

#[event]
pub struct FeesCollected {
    pub business: Pubkey,
    pub pool: Pubkey,
    pub nonce: u64,
    pub received: u64,
    pub collected_total: u64,
    pub total_due: u64,
}

#[event]
pub struct Repaid {
    pub business: Pubkey,
    pub pool: Pubkey,
    pub nonce: u64,
    pub total_due: u64,
    pub covered_by_fees: u64,
    pub topped_up: u64,
    pub was_late: bool,
    pub advances_repaid: u32,
    pub total_volume_repaid: u64,
    pub next_margin_bps: u16,
}

#[event]
pub struct PoolReleased {
    pub business: Pubkey,
    pub pool: Pubkey,
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

#[error_code]
pub enum FloatError {
    #[msg("Caller is not authorised for this action")]
    Unauthorized,
    #[msg("Observation window must be greater than zero")]
    InvalidObservationWindow,
    #[msg("Approved credit limit must be greater than zero")]
    InvalidCreditLimit,
    #[msg("This business has not been verified")]
    BusinessNotVerified,
    #[msg("Pool config account does not belong to this pool")]
    PoolConfigMismatch,
    #[msg("The borrower does not currently hold this pool's creator role")]
    BorrowerDoesNotOwnPool,
    #[msg("This pool has already migrated off the bonding curve")]
    PoolAlreadyMigrated,
    #[msg("This pool has never traded, so it has no fee history to underwrite")]
    PoolHasNeverTraded,
    #[msg("This pool pays its creator no share of trading fees")]
    PoolPaysCreatorNothing,
    #[msg("Float only lends against pools quoted in USDC")]
    PoolNotQuotedInUsdc,
    #[msg("The creator role did not move as expected")]
    CreatorTransferDidNotStick,
    #[msg("Float no longer holds this pool's creator role")]
    FloatNoLongerHoldsCreatorRole,
    #[msg("Amount must be greater than zero")]
    AmountMustBePositive,
    #[msg("Term must be between 1 and 60 days")]
    TermOutOfRange,
    #[msg("A loan is already active for this business")]
    LoanAlreadyActive,
    #[msg("This pledge has already been released")]
    PledgeReleased,
    #[msg("This pledge belongs to a different business")]
    PledgeNotYours,
    #[msg("This loan belongs to a different business")]
    LoanNotYours,
    #[msg("Draw exceeds the approved credit limit")]
    ExceedsApprovedCredit,
    #[msg("The pool has not been observed for long enough to project a fee run rate")]
    ObservationWindowNotElapsed,
    #[msg("The pool's lifetime fee counter moved backwards")]
    PoolFeeCounterWentBackwards,
    #[msg("Projected fees do not cover this draw at the required margin")]
    InsufficientProjectedFees,
    #[msg("There is no active loan")]
    NoActiveLoan,
    #[msg("The loan is still active")]
    LoanStillActive,
    #[msg("Vault balance moved backwards during collection")]
    VaultBalanceWentBackwards,
    #[msg("Token mint does not match the market mint")]
    WrongMint,
    #[msg("Token account has the wrong owner")]
    WrongTokenOwner,
    #[msg("Not the Meteora bonding curve program")]
    WrongDbcProgram,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
