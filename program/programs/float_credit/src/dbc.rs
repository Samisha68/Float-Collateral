/* Meteora Dynamic Bonding Curve interop.

   Float never takes custody of a DBC pool's tokens. It takes the pool's
   *creator role*, which is the authority allowed to claim creator trading
   fees. That role is what secures the loan:

     pledge   borrower signs transfer_pool_creator(borrower -> float PDA)
     collect  float PDA signs claim_creator_trading_fee(-> float vault)
     release  float PDA signs transfer_pool_creator(float PDA -> borrower)

   Once the role has moved, the borrower cannot claim the fees. That is the
   whole security model, and it is enforced by Meteora's program, not by ours.

   We read pool state by byte offset rather than deserialising Meteora's
   account structs, so this program carries no dependency on their crate.
   Every offset below was verified against live mainnet accounts:
   VirtualPool is exactly 424 bytes, PoolConfig exactly 1048. `verify_layout`
   re-checks the discriminator and length on every read, so a Meteora upgrade
   that moves a field fails loudly here instead of mispricing a loan. */

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[cfg(not(feature = "no-entrypoint"))]
pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
#[cfg(feature = "no-entrypoint")]
pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

/// sha256("global:transfer_pool_creator")[..8]
pub const IX_TRANSFER_POOL_CREATOR: [u8; 8] = [20, 7, 169, 33, 58, 147, 166, 33];
/// sha256("global:claim_creator_trading_fee")[..8]
pub const IX_CLAIM_CREATOR_TRADING_FEE: [u8; 8] = [82, 220, 250, 189, 3, 85, 107, 45];

pub const VIRTUAL_POOL_DISC: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
pub const VIRTUAL_POOL_LEN: usize = 424;
pub const POOL_CONFIG_DISC: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
pub const POOL_CONFIG_LEN: usize = 1048;

/* VirtualPool field offsets, discriminator included. */
pub const VP_CONFIG: usize = 72;
pub const VP_CREATOR: usize = 104;
pub const VP_BASE_MINT: usize = 136;
pub const VP_BASE_VAULT: usize = 168;
pub const VP_QUOTE_VAULT: usize = 200;
pub const VP_IS_MIGRATED: usize = 305;
pub const VP_TOTAL_TRADING_QUOTE_FEE: usize = 336;
pub const VP_CREATOR_BASE_FEE: usize = 352;
pub const VP_CREATOR_QUOTE_FEE: usize = 360;
pub const VP_HAS_SWAP: usize = 370;

/* PoolConfig field offsets, discriminator included. */
pub const PC_QUOTE_MINT: usize = 8;
pub const PC_TOKEN_TYPE: usize = 237;
pub const PC_QUOTE_TOKEN_FLAG: usize = 238;
pub const PC_CREATOR_TRADING_FEE_PCT: usize = 245;

pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";

fn verify_layout(info: &AccountInfo, disc: [u8; 8], len: usize) -> Result<()> {
    require_keys_eq!(*info.owner, DBC_PROGRAM_ID, DbcError::NotADbcAccount);
    let data = info.try_borrow_data()?;
    require!(data.len() == len, DbcError::UnexpectedAccountLayout);
    require!(data[..8] == disc, DbcError::UnexpectedAccountLayout);
    Ok(())
}

fn read_pubkey(info: &AccountInfo, off: usize) -> Result<Pubkey> {
    let data = info.try_borrow_data()?;
    let bytes: [u8; 32] = data[off..off + 32]
        .try_into()
        .map_err(|_| error!(DbcError::UnexpectedAccountLayout))?;
    Ok(Pubkey::new_from_array(bytes))
}

fn read_u64(info: &AccountInfo, off: usize) -> Result<u64> {
    let data = info.try_borrow_data()?;
    let bytes: [u8; 8] = data[off..off + 8]
        .try_into()
        .map_err(|_| error!(DbcError::UnexpectedAccountLayout))?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_u8(info: &AccountInfo, off: usize) -> Result<u8> {
    let data = info.try_borrow_data()?;
    Ok(data[off])
}

/// The subset of DBC pool state Float underwrites against.
pub struct PoolView {
    pub config: Pubkey,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub is_migrated: bool,
    pub has_swap: bool,
    pub total_trading_quote_fee: u64,
    pub creator_base_fee: u64,
    pub creator_quote_fee: u64,
}

impl PoolView {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        verify_layout(info, VIRTUAL_POOL_DISC, VIRTUAL_POOL_LEN)?;
        Ok(Self {
            config: read_pubkey(info, VP_CONFIG)?,
            creator: read_pubkey(info, VP_CREATOR)?,
            base_mint: read_pubkey(info, VP_BASE_MINT)?,
            base_vault: read_pubkey(info, VP_BASE_VAULT)?,
            quote_vault: read_pubkey(info, VP_QUOTE_VAULT)?,
            is_migrated: read_u8(info, VP_IS_MIGRATED)? != 0,
            has_swap: read_u8(info, VP_HAS_SWAP)? != 0,
            total_trading_quote_fee: read_u64(info, VP_TOTAL_TRADING_QUOTE_FEE)?,
            creator_base_fee: read_u64(info, VP_CREATOR_BASE_FEE)?,
            creator_quote_fee: read_u64(info, VP_CREATOR_QUOTE_FEE)?,
        })
    }
}

/// The subset of DBC pool config Float underwrites against.
pub struct ConfigView {
    pub quote_mint: Pubkey,
    pub token_type: u8,
    pub quote_token_flag: u8,
    pub creator_trading_fee_pct: u8,
}

impl ConfigView {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        verify_layout(info, POOL_CONFIG_DISC, POOL_CONFIG_LEN)?;
        Ok(Self {
            quote_mint: read_pubkey(info, PC_QUOTE_MINT)?,
            token_type: read_u8(info, PC_TOKEN_TYPE)?,
            quote_token_flag: read_u8(info, PC_QUOTE_TOKEN_FLAG)?,
            creator_trading_fee_pct: read_u8(info, PC_CREATOR_TRADING_FEE_PCT)?,
        })
    }
}

/// CPI: hand the pool's creator role to `new_creator`.
/// `creator_info` must be the signer that currently holds the role.
pub fn transfer_pool_creator<'info>(
    dbc_program: &AccountInfo<'info>,
    virtual_pool: &AccountInfo<'info>,
    config: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    new_creator: &AccountInfo<'info>,
    event_authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = Instruction {
        program_id: DBC_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(virtual_pool.key(), false),
            AccountMeta::new_readonly(config.key(), false),
            AccountMeta::new_readonly(creator.key(), true),
            AccountMeta::new_readonly(new_creator.key(), false),
            AccountMeta::new_readonly(event_authority.key(), false),
            AccountMeta::new_readonly(DBC_PROGRAM_ID, false),
        ],
        data: IX_TRANSFER_POOL_CREATOR.to_vec(),
    };
    invoke_signed(
        &ix,
        &[
            virtual_pool.clone(),
            config.clone(),
            creator.clone(),
            new_creator.clone(),
            event_authority.clone(),
            dbc_program.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}

/// CPI: claim accrued creator trading fees into Float's token accounts.
/// `creator` is Float's pool-authority PDA and signs with `signer_seeds`.
#[allow(clippy::too_many_arguments)]
pub fn claim_creator_trading_fee<'info>(
    dbc_program: &AccountInfo<'info>,
    dbc_pool_authority: &AccountInfo<'info>,
    virtual_pool: &AccountInfo<'info>,
    token_a_account: &AccountInfo<'info>,
    token_b_account: &AccountInfo<'info>,
    base_vault: &AccountInfo<'info>,
    quote_vault: &AccountInfo<'info>,
    base_mint: &AccountInfo<'info>,
    quote_mint: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    token_base_program: &AccountInfo<'info>,
    token_quote_program: &AccountInfo<'info>,
    event_authority: &AccountInfo<'info>,
    max_base_amount: u64,
    max_quote_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = IX_CLAIM_CREATOR_TRADING_FEE.to_vec();
    data.extend_from_slice(&max_base_amount.to_le_bytes());
    data.extend_from_slice(&max_quote_amount.to_le_bytes());

    let ix = Instruction {
        program_id: DBC_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(dbc_pool_authority.key(), false),
            AccountMeta::new(virtual_pool.key(), false),
            AccountMeta::new(token_a_account.key(), false),
            AccountMeta::new(token_b_account.key(), false),
            AccountMeta::new(base_vault.key(), false),
            AccountMeta::new(quote_vault.key(), false),
            AccountMeta::new_readonly(base_mint.key(), false),
            AccountMeta::new_readonly(quote_mint.key(), false),
            AccountMeta::new_readonly(creator.key(), true),
            AccountMeta::new_readonly(token_base_program.key(), false),
            AccountMeta::new_readonly(token_quote_program.key(), false),
            AccountMeta::new_readonly(event_authority.key(), false),
            AccountMeta::new_readonly(DBC_PROGRAM_ID, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            dbc_pool_authority.clone(),
            virtual_pool.clone(),
            token_a_account.clone(),
            token_b_account.clone(),
            base_vault.clone(),
            quote_vault.clone(),
            base_mint.clone(),
            quote_mint.clone(),
            creator.clone(),
            token_base_program.clone(),
            token_quote_program.clone(),
            event_authority.clone(),
            dbc_program.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}

#[error_code]
pub enum DbcError {
    #[msg("Account is not owned by the Meteora bonding curve program")]
    NotADbcAccount,
    #[msg("Meteora account layout does not match the version this program was built against")]
    UnexpectedAccountLayout,
}
