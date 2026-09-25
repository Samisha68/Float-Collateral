use anchor_lang::prelude::*;

/* What an advance costs, and what a repayment record earns.

   Ported verbatim in shape from Float's `web/server/pricing.mjs`. The numbers
   are the same numbers; only the units differ, because a Solana program does
   no floating-point arithmetic. Percentages are basis points throughout:
   150% is 15_000 bps, a 1.8% fee is 180 bps.

   The rule this encodes, unchanged from the original: a repayment record buys
   a better price, never a bigger advance. The advance stays capped by the
   approved credit limit, which lives on BusinessVerification and which no
   credit instruction can write. */

/// Collateral coverage a borrower with no record must show: 150%.
pub const BASE_MARGIN_BPS: u32 = 15_000;
/// Each repayment takes 5 points off the coverage requirement.
pub const MARGIN_STEP_BPS: u32 = 500;
/// Each repayment takes 0.1 points off the fee.
pub const FEE_STEP_BPS: u32 = 10;
/// The record stops earning after six repayments.
pub const RECORD_STEPS: u32 = 6;

/// Published fee by term, in basis points of principal, interpolated between
/// the listed points. Mirrors RATE_POINTS in pricing.mjs.
const RATE_POINTS: [(u32, u32); 6] = [(0, 0), (7, 60), (14, 100), (30, 180), (45, 250), (60, 320)];

/// Coverage required for this borrower: 150% at zero repayments, 120% at six.
pub fn margin_bps(repayments: u32) -> u32 {
    BASE_MARGIN_BPS - repayments.min(RECORD_STEPS) * MARGIN_STEP_BPS
}

/// The published fee for a term, before any record discount.
pub fn base_rate_bps(days: u32) -> u32 {
    let idx = RATE_POINTS.iter().position(|p| p.0 >= days).unwrap_or(RATE_POINTS.len() - 1);
    let high = RATE_POINTS[idx.max(1)];
    let low = RATE_POINTS[idx.saturating_sub(1)];
    if high.0 == low.0 {
        return high.1;
    }
    let span = (high.0 - low.0) as u64;
    let rise = (high.1 - low.1) as u64;
    let along = (days.saturating_sub(low.0)) as u64;
    (low.1 as u64 + rise * along / span) as u32
}

/// The fee this borrower actually pays. The discount never takes the fee below
/// half the published rate, so a clean record makes credit cheaper without
/// ever making it free.
pub fn rate_bps(days: u32, repayments: u32) -> u32 {
    let base = base_rate_bps(days);
    let earned = repayments.min(RECORD_STEPS) * FEE_STEP_BPS;
    base.saturating_sub(earned).max(base / 2)
}

/// Fee in USDC base units for a principal, rounded up so the protocol is never
/// short by a rounding remainder.
pub fn fee_amount(principal: u64, days: u32, repayments: u32) -> Option<u64> {
    let bps = rate_bps(days, repayments) as u128;
    let num = (principal as u128).checked_mul(bps)?;
    let fee = num.div_ceil(10_000u128);
    u64::try_from(fee).ok()
}

/// Collateral quality sets the margin; the record improves it.
///
/// A fee stream cannot be seized. Float collects it at source, and if the
/// pool's volume dies there is nothing to sell, so the borrower's record is
/// doing the underwriting. An escrowed token is the opposite: it can be taken
/// and sold, but its price moves while Float holds it, so it carries a
/// haircut on top of the ladder to absorb that move.
///
/// The ladder is the same either way. Only the starting point differs, which
/// is the point: repaying improves the price of credit whatever backs it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum CollateralKind {
    /// A Meteora DBC creator fee stream. Collected at source, never seized.
    #[default]
    FeeStream,
    /// An escrowed SPL or Token-2022 balance, valued at a posted price.
    Token,
}

/// Added to the margin an escrowed token must post, because a price can move
/// between the last update and a liquidation.
pub const TOKEN_HAIRCUT_BPS: u32 = 5_000; // +50 points: 200% down to 170%

/// The coverage this borrower must post, for this kind of collateral.
pub fn margin_bps_for(kind: CollateralKind, repayments: u32) -> u32 {
    match kind {
        CollateralKind::FeeStream => margin_bps(repayments),
        CollateralKind::Token => margin_bps(repayments) + TOKEN_HAIRCUT_BPS,
    }
}

/// What an escrowed balance is worth, in USDC base units.
///
/// `price` is USDC-6dp per whole token, so the token's own decimals have to
/// come out. u128 throughout: a 9-decimal balance times a 6-decimal price
/// overflows u64 long before the numbers get interesting.
pub fn token_value_usdc(amount: u64, price: u64, decimals: u8) -> Option<u64> {
    let scale = 10u128.checked_pow(decimals as u32)?;
    let value = (amount as u128).checked_mul(price as u128)?.checked_div(scale)?;
    u64::try_from(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_collateral_posts_more_than_a_fee_stream() {
        // Same borrower, same record, different collateral. A token can be
        // seized and sold, but its price moves while Float holds it.
        for n in 0..=6 {
            let stream = margin_bps_for(CollateralKind::FeeStream, n);
            let token = margin_bps_for(CollateralKind::Token, n);
            assert_eq!(token, stream + TOKEN_HAIRCUT_BPS);
            assert!(token > stream);
        }
        assert_eq!(margin_bps_for(CollateralKind::Token, 0), 20_000); // 200%
        assert_eq!(margin_bps_for(CollateralKind::Token, 6), 17_000); // 170%
    }

    #[test]
    fn the_record_improves_both_rails() {
        // The whole thesis: whatever backs the loan, repaying makes it cheaper.
        for kind in [CollateralKind::FeeStream, CollateralKind::Token] {
            assert!(margin_bps_for(kind, 6) < margin_bps_for(kind, 0));
            assert_eq!(margin_bps_for(kind, 0) - margin_bps_for(kind, 6), 3_000);
        }
    }

    #[test]
    fn a_nine_decimal_balance_values_without_overflowing() {
        // 7.3818 tokens at 9dp, priced at $812.79 (USDC 6dp).
        assert_eq!(token_value_usdc(7_381_900_000, 812_790_000, 9), Some(5_999_934_501));
        // The same maths at 6dp, so the decimals really are coming out.
        assert_eq!(token_value_usdc(1_000_000, 812_790_000, 6), Some(812_790_000));
        // u128 absorbs the product; the guard that matters is the narrowing
        // back to u64 at the end. A zero-decimal token at a huge price is the
        // case that exercises it.
        assert!(token_value_usdc(u64::MAX, 1_000_000_000, 0).is_none());
        // And a wide balance that does still fit comes back intact.
        assert_eq!(token_value_usdc(u64::MAX, 1_000_000, 9), Some(18_446_744_073_709_551));
        assert_eq!(token_value_usdc(0, 812_790_000, 9), Some(0));
    }

    #[test]
    fn margin_ladder_matches_pricing_mjs() {
        // 0 -> 150%, 1 -> 145%, ... 6+ -> 120%
        assert_eq!(margin_bps(0), 15_000);
        assert_eq!(margin_bps(1), 14_500);
        assert_eq!(margin_bps(2), 14_000);
        assert_eq!(margin_bps(3), 13_500);
        assert_eq!(margin_bps(4), 13_000);
        assert_eq!(margin_bps(5), 12_500);
        assert_eq!(margin_bps(6), 12_000);
        assert_eq!(margin_bps(11), 12_000, "record stops earning after six");
    }

    #[test]
    fn base_rate_matches_published_points() {
        assert_eq!(base_rate_bps(7), 60);
        assert_eq!(base_rate_bps(14), 100);
        assert_eq!(base_rate_bps(30), 180);
        assert_eq!(base_rate_bps(60), 320);
        // interpolated: halfway between 14d (100) and 30d (180)
        assert_eq!(base_rate_bps(22), 140);
    }

    #[test]
    fn record_discount_has_a_floor() {
        // 30 days: 180 bps base, minus 6 * 10 = 120 bps, above the 90 bps floor
        assert_eq!(rate_bps(30, 6), 120);
        // 7 days: 60 bps base, floor is 30 bps, discount would take it to 0
        assert_eq!(rate_bps(7, 6), 30);
        assert!(rate_bps(7, 100) >= base_rate_bps(7) / 2);
    }

    #[test]
    fn fee_rounds_up_never_down() {
        // 5_000 USDC at 180 bps = 90 USDC exactly
        assert_eq!(fee_amount(5_000_000_000, 30, 0), Some(90_000_000));
        // a principal that does not divide cleanly rounds up, not down
        assert_eq!(fee_amount(1, 30, 0), Some(1));
    }

    #[test]
    fn proven_borrower_pays_less_than_new_borrower() {
        let new_fee = fee_amount(5_000_000_000, 30, 0).unwrap();
        let proven_fee = fee_amount(5_000_000_000, 30, 6).unwrap();
        assert!(proven_fee < new_fee);
        assert_eq!(new_fee, 90_000_000);
        assert_eq!(proven_fee, 60_000_000);
    }
}
