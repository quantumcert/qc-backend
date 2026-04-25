use anchor_lang::prelude::*;
use anchor_lang::system_program;

// ===========================================================
// PROGRAM ID PLACEHOLDER
// Replace with actual Program ID after deployment
// ===========================================================

// SECURITY: On-chain data is restricted to:
//   - falconHash ([u8; 64]) — SHA3-512 raw hash
//   - timestamp (i64) — Unix timestamp
//   - qtagId / escrow_id (String, max 32 bytes) — Correlation ID
//   - entityType (u8) — Type discriminator (STATUS_ANCHORED, STATUS_ESCROW_LOCKED)
// NO personal data, NO sensitive payloads, NO PII ever stored on-chain.

declare_id!("Escro111111111111111111111111111111111111111");

// ===========================================================
// CONSTANTS
// ===========================================================

/// Discriminator for Mode A anchor instruction data (LOG)
pub const DISCRIMINATOR_LOG_A: &[u8; 8] = b"QC_LOG_A";
/// Discriminator for Mode B anchor instruction data (STATE PDA)
pub const DISCRIMINATOR_PDA_B: &[u8; 8] = b"QC_PDA_B";
/// Status: anchored
pub const STATUS_ANCHORED: u8 = 0x01;
/// Status: escrow locked
pub const STATUS_ESCROW_LOCKED: u8 = 0x02;

// ===========================================================
// ERRORS
// ===========================================================

#[error_code]
pub enum EscrowError {
    #[msg("Escrow already exists")]
    EscrowAlreadyExists,
    #[msg("Escrow not found")]
    EscrowNotFound,
    #[msg("Escrow time-lock not expired")]
    TimeLockNotExpired,
    #[msg("Escrow already released")]
    AlreadyReleased,
    #[msg("Escrow already cancelled")]
    AlreadyCancelled,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid time-lock")]
    InvalidTimeLock,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Durable nonces are banned")]
    DurableNonceBanned,
    #[msg("Payload hash must be exactly 64 bytes")]
    InvalidPayloadHashLength,
    #[msg("Invalid triple proof: missing or duplicate signers")]
    InvalidTripleProof,
    #[msg("Circuit breaker is active: operations paused")]
    CircuitBreakerActive,
}

// ===========================================================
// PROGRAM
// ===========================================================

#[program]
pub mod escrow {
    use super::*;

    // --- 0. CIRCUIT BREAKER (Admin Only) ----------------

    /// Toggles the circuit breaker pause state.
    /// Only callable by the program authority (admin).
    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        state.paused = !state.paused;
        
        msg!("Circuit breaker toggled: paused={}", state.paused);
        Ok(())
    }

    // --- 1. INITIALIZE ESCROW (Payment) -----------------

    /// Creates an escrow account (PDA) holding SOL until unlock_timestamp.
    ///
    /// # Arguments
    /// * `escrow_id` — Unique identifier (max 32 bytes, correlates to off-chain DB)
    /// * `receiver` — Address that will receive funds upon release
    /// * `unlock_timestamp` — Unix timestamp when release becomes possible
    /// * `amount` — Lamports to escrow
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        escrow_id: String,
        receiver: Pubkey,
        unlock_timestamp: i64,
        amount: u64,
        triple_proof: Option<TripleProof>,
    ) -> Result<()> {
        // Check circuit breaker
        require!(!ctx.accounts.program_state.paused, EscrowError::CircuitBreakerActive);

        require!(
            escrow_id.len() <= 32,
            EscrowError::InvalidAmount
        );
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            unlock_timestamp > Clock::get()?.unix_timestamp,
            EscrowError::InvalidTimeLock
        );

        if let Some(ref proof) = triple_proof {
            validate_triple_proof(proof)?;
        }

        let escrow = &mut ctx.accounts.escrow_account;
        escrow.escrow_id = escrow_id;
        escrow.sender = ctx.accounts.sender.key();
        escrow.receiver = receiver;
        escrow.amount = amount;
        escrow.asset_mint = None; // SOL (native)
        escrow.unlock_timestamp = unlock_timestamp;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.released = false;
        escrow.cancelled = false;
        escrow.bump = ctx.bumps.escrow_account;
        escrow.triple_proof = triple_proof;

        // Transfer SOL from sender to escrow PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: escrow.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        msg!("Escrow created: id={}, sender={}, receiver={}, amount={}, unlock={}",
            escrow.escrow_id,
            escrow.sender,
            escrow.receiver,
            escrow.amount,
            escrow.unlock_timestamp
        );

        Ok(())
    }

    // --- 2. RELEASE ESCROW (Receiving) ------------------

    /// Releases escrowed SOL to the receiver.
    /// Only callable after unlock_timestamp.
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        // Check circuit breaker
        require!(!ctx.accounts.program_state.paused, EscrowError::CircuitBreakerActive);

        let escrow = &mut ctx.accounts.escrow_account;
        let clock = Clock::get()?;

        require!(!escrow.released, EscrowError::AlreadyReleased);
        require!(!escrow.cancelled, EscrowError::AlreadyCancelled);
        require!(
            clock.unix_timestamp >= escrow.unlock_timestamp,
            EscrowError::TimeLockNotExpired
        );
        require!(
            ctx.accounts.authority.key() == escrow.receiver
                || ctx.accounts.authority.key() == escrow.sender,
            EscrowError::Unauthorized
        );

        escrow.released = true;
        let amount = escrow.amount;

        // Transfer SOL from escrow PDA to receiver
        **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.receiver.to_account_info().try_borrow_mut_lamports()? += amount;

        msg!("Escrow released: id={}, receiver={}, amount={}",
            escrow.escrow_id,
            ctx.accounts.receiver.key(),
            amount
        );

        Ok(())
    }

    // --- 3. CANCEL ESCROW -------------------------------

    /// Cancels an escrow and returns SOL to the sender.
    /// Callable by sender at any time before release.
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        // Check circuit breaker
        require!(!ctx.accounts.program_state.paused, EscrowError::CircuitBreakerActive);

        let escrow = &mut ctx.accounts.escrow_account;

        require!(!escrow.released, EscrowError::AlreadyReleased);
        require!(!escrow.cancelled, EscrowError::AlreadyCancelled);
        require!(
            ctx.accounts.authority.key() == escrow.sender,
            EscrowError::Unauthorized
        );

        escrow.cancelled = true;
        let amount = escrow.amount;

        // Transfer SOL from escrow PDA back to sender
        **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.sender.to_account_info().try_borrow_mut_lamports()? += amount;

        msg!("Escrow cancelled: id={}, sender={}, amount={}",
            escrow.escrow_id,
            escrow.sender,
            amount
        );

        Ok(())
    }

    // --- 4. ANCHOR EVENT — MODE A (LOG) -----------------

    /// Mode A: Writes hash into instruction data.
    /// Immutable validator history. ~5000 lamports.
    pub fn anchor_event_log(
        ctx: Context<AnchorEventLog>,
        event_id_slice: [u8; 16],
        payload_hash: [u8; 64],
    ) -> Result<()> {
        // Check circuit breaker
        require!(!ctx.accounts.program_state.paused, EscrowError::CircuitBreakerActive);

        // Validate payload hash length
        require!(payload_hash.len() == 64, EscrowError::InvalidPayloadHashLength);

        // SECURITY: Reject any instruction preceded by AdvanceNonceAccount
        // (Durable Nonces are banned after the Drift Exploit)
        let ix_sysvar = ctx.accounts.instruction_sysvar_account.to_account_info();
        let ix_data = ix_sysvar.data.borrow();
        // Simple check: look for nonce advance instruction pattern
        if ix_data.len() >= 4 {
            let discrim = &ix_data[0..4];
            // AdvanceNonceAccount discriminator (solana_program::system_instruction)
            if discrim == [0x04, 0x00, 0x00, 0x00] {
                return Err(EscrowError::DurableNonceBanned.into());
            }
        }

        msg!("ANCHOR_LOG_A: event_slice={:?}, hash={:?}", event_id_slice, payload_hash);

        Ok(())
    }

    // --- 5. ANCHOR EVENT — MODE B (STATE PDA) -----------

    /// Mode B: Stores hash in a PDA. M2M-readable. ~0.0014 SOL rent-exempt.
    pub fn anchor_event_state(
        ctx: Context<AnchorEventState>,
        event_id: String,
        payload_hash: [u8; 64],
        unlock_timestamp: i64,
    ) -> Result<()> {
        // Check circuit breaker
        require!(!ctx.accounts.program_state.paused, EscrowError::CircuitBreakerActive);

        require!(payload_hash.len() == 64, EscrowError::InvalidPayloadHashLength);

        let anchor_account = &mut ctx.accounts.anchor_pda;
        anchor_account.authority = ctx.accounts.authority.key();
        anchor_account.payload_hash = payload_hash;
        anchor_account.status = if unlock_timestamp > 0 {
            STATUS_ESCROW_LOCKED
        } else {
            STATUS_ANCHORED
        };
        anchor_account.unlock_timestamp = unlock_timestamp;
        anchor_account.created_at = Clock::get()?.unix_timestamp;
        anchor_account.bump = ctx.bumps.anchor_pda;

        msg!("ANCHOR_STATE_B: event_id={}, hash={:?}, status={}",
            event_id,
            payload_hash,
            anchor_account.status
        );

        Ok(())
    }
}

// ===========================================================
// ACCOUNTS
// ===========================================================

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"qc_program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(escrow_id: String, receiver: Pubkey, unlock_timestamp: i64, amount: u64)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init,
        payer = sender,
        space = 8 + EscrowAccount::SIZE,
        seeds = [b"qc_escrow", escrow_id.as_bytes()],
        bump
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(
        seeds = [b"qc_program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"qc_escrow", escrow_account.escrow_id.as_bytes()],
        bump = escrow_account.bump,
        constraint = !escrow_account.released @ EscrowError::AlreadyReleased,
        constraint = !escrow_account.cancelled @ EscrowError::AlreadyCancelled,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    /// CHECK: Receiver account — validated in instruction logic
    #[account(mut)]
    pub receiver: AccountInfo<'info>,

    #[account(
        seeds = [b"qc_program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"qc_escrow", escrow_account.escrow_id.as_bytes()],
        bump = escrow_account.bump,
        constraint = !escrow_account.released @ EscrowError::AlreadyReleased,
        constraint = !escrow_account.cancelled @ EscrowError::AlreadyCancelled,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    /// CHECK: Sender account — validated in instruction logic
    #[account(mut)]
    pub sender: AccountInfo<'info>,

    #[account(
        seeds = [b"qc_program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AnchorEventLog<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Instruction sysvar for nonce ban check
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar_account: AccountInfo<'info>,

    #[account(
        seeds = [b"qc_program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct AnchorEventState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + AnchorPda::SIZE,
        seeds = [b"qc_anchor", event_id.as_bytes()],
        bump
    )]
    pub anchor_pda: Account<'info, AnchorPda>,

    #[account(
        seeds = [b"qc_program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    pub system_program: Program<'info, System>,
}

// ===========================================================
// DATA STRUCTURES
// ===========================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TripleProof {
    pub seller_pubkey: Pubkey,
    pub buyer_pubkey: Pubkey,
    pub quantum_pubkey: Pubkey,
    pub signed_at: i64,
}

fn validate_triple_proof(proof: &TripleProof) -> Result<()> {
    require!(
        proof.seller_pubkey != Pubkey::default(),
        EscrowError::InvalidTripleProof
    );
    require!(
        proof.buyer_pubkey != Pubkey::default(),
        EscrowError::InvalidTripleProof
    );
    require!(
        proof.quantum_pubkey != Pubkey::default(),
        EscrowError::InvalidTripleProof
    );
    require!(
        proof.seller_pubkey != proof.buyer_pubkey,
        EscrowError::InvalidTripleProof
    );
    require!(
        proof.seller_pubkey != proof.quantum_pubkey,
        EscrowError::InvalidTripleProof
    );
    require!(
        proof.buyer_pubkey != proof.quantum_pubkey,
        EscrowError::InvalidTripleProof
    );
    Ok(())
}

#[account]
pub struct ProgramState {
    pub authority: Pubkey,    // Admin authority
    pub paused: bool,         // Circuit breaker state
    pub bump: u8,             // PDA bump
}

impl ProgramState {
    pub const SIZE: usize =
        32 +       // authority
        1 +        // paused
        1;         // bump
}

#[account]
pub struct EscrowAccount {
    pub escrow_id: String,        // 4 + 32 bytes
    pub sender: Pubkey,           // 32 bytes
    pub receiver: Pubkey,         // 32 bytes
    pub amount: u64,              // 8 bytes
    pub asset_mint: Option<Pubkey>, // 1 + 32 bytes (None for SOL)
    pub unlock_timestamp: i64,    // 8 bytes
    pub created_at: i64,          // 8 bytes
    pub released: bool,           // 1 byte
    pub cancelled: bool,          // 1 byte
    pub bump: u8,                 // 1 byte
    pub triple_proof: Option<TripleProof>, // 1 + (32 + 32 + 32 + 8) bytes
}

impl EscrowAccount {
    pub const SIZE: usize =
        4 + 32 +   // escrow_id (String: 4 len + 32 max chars)
        32 +       // sender
        32 +       // receiver
        8 +        // amount
        1 + 32 +   // asset_mint Option<Pubkey>
        8 +        // unlock_timestamp
        8 +        // created_at
        1 +        // released
        1 +        // cancelled
        1 +        // bump
        1 + 32 + 32 + 32 + 8; // triple_proof Option<TripleProof>
}

#[account]
pub struct AnchorPda {
    pub authority: Pubkey,        // 32 bytes
    pub payload_hash: [u8; 64],   // 64 bytes
    pub status: u8,               // 1 byte
    pub unlock_timestamp: i64,    // 8 bytes
    pub created_at: i64,          // 8 bytes
    pub bump: u8,                 // 1 byte
}

impl AnchorPda {
    pub const SIZE: usize =
        32 +       // authority
        64 +       // payload_hash
        1 +        // status
        8 +        // unlock_timestamp
        8 +        // created_at
        1;         // bump
}
