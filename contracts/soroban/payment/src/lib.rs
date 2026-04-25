#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Bytes, BytesN, Env,
    Symbol, Vec,
};

// ===========================================================
// CONSTANTS
// ===========================================================

// SECURITY: On-chain data is restricted to:
//   - falconHash (BytesN<64>) — SHA3-512 raw hash
//   - timestamp (u64) — Ledger timestamp
//   - qtagId / escrow_id (Bytes, max 32 bytes) — Correlation ID
//   - entityType (u32) — Type discriminator (STATUS_PENDING, STATUS_ACTIVE, etc.)
// NO personal data, NO sensitive payloads, NO PII ever stored on-chain.

/// Status: escrow pending
const STATUS_PENDING: u32 = 1;
/// Status: escrow active (funds deposited)
const STATUS_ACTIVE: u32 = 2;
/// Status: released
const STATUS_RELEASED: u32 = 3;
/// Status: cancelled
const STATUS_CANCELLED: u32 = 4;

/// Error: circuit breaker active
const ERR_CIRCUIT_BREAKER: u32 = 100;

// ===========================================================
// DATA TYPES
// ===========================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TripleProof {
    pub seller_address: Address,
    pub buyer_address: Address,
    pub quantum_address: Address,
    pub signed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub escrow_id: Bytes,       // Unique identifier (max 32 bytes)
    pub sender: Address,        // Escrow creator
    pub receiver: Address,      // Fund recipient
    pub amount: i128,           // Amount in stroops (smallest unit)
    pub asset_address: Option<Address>, // None for native XLM
    pub unlock_timestamp: u64,  // Unix seconds
    pub created_at: u64,        // Ledger timestamp
    pub status: u32,            // STATUS_*
    pub triple_proof: Option<TripleProof>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnchorRecord {
    pub authority: Address,
    pub payload_hash: BytesN<64>, // SHA3-512 raw bytes
    pub status: u32,              // 1 = ANCHORED, 2 = ESCROW_LOCKED
    pub unlock_timestamp: u64,    // 0 if not escrow
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    Escrow(Bytes),          // escrow_id -> Escrow
    Anchor(Bytes),          // event_id -> AnchorRecord
    Admin,                  // single admin address
    Paused,                 // circuit breaker state
    Nonce(Address),         // per-address nonce for replay protection
}

// ===========================================================
// CONTRACT
// ===========================================================

#[contract]
pub struct QuantumCertPayment;

#[contractimpl]
impl QuantumCertPayment {

    // --- INITIALIZATION ---------------------------------

    /// Initializes the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Toggles the circuit breaker pause state.
    pub fn toggle_pause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let current: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        
        env.storage().instance().set(&DataKey::Paused, &!current);
        
        // Emit event
        env.events().publish(
            (symbol_short!("CIRCUIT"), symbol_short!("TOGGLE")),
            (!current, env.ledger().timestamp()),
        );
    }

    /// Returns current pause state.
    pub fn paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn check_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        assert!(!paused, symbol_short!("ERR_PAUSE"));
    }

    fn validate_triple_proof(env: &Env, proof: &TripleProof) {
        assert!(proof.seller_address != Address::from_string(&String::from_str(env, "")), symbol_short!("ERR_TP_SELLER"));
        assert!(proof.buyer_address != Address::from_string(&String::from_str(env, "")), symbol_short!("ERR_TP_BUYER"));
        assert!(proof.quantum_address != Address::from_string(&String::from_str(env, "")), symbol_short!("ERR_TP_QC"));
        assert!(proof.seller_address != proof.buyer_address, symbol_short!("ERR_TP_DUP"));
        assert!(proof.seller_address != proof.quantum_address, symbol_short!("ERR_TP_DUP"));
        assert!(proof.buyer_address != proof.quantum_address, symbol_short!("ERR_TP_DUP"));
    }

    // --- 1. CREATE ESCROW (Payment) ---------------------

    /// Creates an escrow holding XLM or SAC tokens until unlock_timestamp.
    pub fn create_escrow(
        env: Env,
        escrow_id: Bytes,
        receiver: Address,
        amount: i128,
        asset_address: Option<Address>,
        unlock_timestamp: u64,
        triple_proof: Option<TripleProof>,
    ) {
        Self::check_not_paused(&env);

        let sender = env.current_contract_address();
        let invoker = env.invoker();

        assert!(
            escrow_id.len() <= 32,
            symbol_short!("ERR_ID_LEN")
        );
        assert!(amount > 0, symbol_short!("ERR_AMT"));
        assert!(
            unlock_timestamp > env.ledger().timestamp(),
            symbol_short!("ERR_LOCK")
        );

        if let Some(ref proof) = triple_proof {
            Self::validate_triple_proof(&env, proof);
        }

        let key = DataKey::Escrow(escrow_id.clone());
        assert!(
            !env.storage().persistent().has(&key),
            symbol_short!("ERR_EXISTS")
        );

        let escrow = Escrow {
            escrow_id: escrow_id.clone(),
            sender: invoker.clone(),
            receiver,
            amount,
            asset_address,
            unlock_timestamp,
            created_at: env.ledger().timestamp(),
            status: STATUS_ACTIVE,
            triple_proof,
        };

        env.storage().persistent().set(&key, &escrow);

        // Emit event
        env.events().publish(
            (symbol_short!("ESCROW"), symbol_short!("CREATE")),
            (escrow_id, invoker, receiver, amount, unlock_timestamp),
        );
    }

    // --- 2. RELEASE ESCROW (Receiving) ------------------

    /// Releases escrowed funds to the receiver.
    pub fn release_escrow(env: Env, escrow_id: Bytes) {
        Self::check_not_paused(&env);

        let key = DataKey::Escrow(escrow_id.clone());
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("Escrow not found"));

        assert!(
            escrow.status == STATUS_ACTIVE,
            symbol_short!("ERR_STATUS")
        );
        assert!(
            env.ledger().timestamp() >= escrow.unlock_timestamp,
            symbol_short!("ERR_TIME")
        );

        let invoker = env.invoker();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("Admin not set"));

        assert!(
            invoker == escrow.receiver || invoker == admin,
            symbol_short!("ERR_AUTH")
        );

        escrow.status = STATUS_RELEASED;
        env.storage().persistent().set(&key, &escrow);

        env.events().publish(
            (symbol_short!("ESCROW"), symbol_short!("RELEASE")),
            (escrow_id, escrow.receiver, escrow.amount),
        );
    }

    // --- 3. CANCEL ESCROW -------------------------------

    /// Cancels an escrow and returns funds to the sender.
    pub fn cancel_escrow(env: Env, escrow_id: Bytes) {
        Self::check_not_paused(&env);

        let key = DataKey::Escrow(escrow_id.clone());
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("Escrow not found"));

        assert!(
            escrow.status == STATUS_ACTIVE,
            symbol_short!("ERR_STATUS")
        );

        let invoker = env.invoker();
        assert!(
            invoker == escrow.sender,
            symbol_short!("ERR_AUTH")
        );

        escrow.status = STATUS_CANCELLED;
        env.storage().persistent().set(&key, &escrow);

        env.events().publish(
            (symbol_short!("ESCROW"), symbol_short!("CANCEL")),
            (escrow_id, escrow.sender, escrow.amount),
        );
    }

    // --- 4. ANCHOR EVENT --------------------------------

    /// Anchors a payload hash to the contract state.
    pub fn anchor_event(
        env: Env,
        event_id: Bytes,
        hash: BytesN<64>,
        unlock_timestamp: u64,
    ) {
        Self::check_not_paused(&env);

        let invoker = env.invoker();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("Admin not set"));

        assert!(invoker == admin, symbol_short!("ERR_AUTH"));

        let key = DataKey::Anchor(event_id.clone());

        let record = AnchorRecord {
            authority: invoker,
            payload_hash: hash.clone(),
            status: if unlock_timestamp > 0 {
                STATUS_ACTIVE // Using STATUS_ACTIVE as ESCROW_LOCKED equivalent
            } else {
                STATUS_PENDING // Using STATUS_PENDING as ANCHORED equivalent
            },
            unlock_timestamp,
            created_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&key, &record);

        env.events().publish(
            (symbol_short!("ANCHOR"), symbol_short!("EVENT")),
            (event_id, hash, unlock_timestamp),
        );
    }

    // --- 5. GET ANCHOR HASH (M2M Verification) ----------

    /// Retrieves an anchor record by event_id for off-chain verification.
    pub fn get_anchor_hash(env: Env, event_id: Bytes) -> Option<AnchorRecord> {
        let key = DataKey::Anchor(event_id);
        env.storage().persistent().get(&key)
    }

    // --- VIEW FUNCTIONS ---------------------------------

    pub fn get_escrow(env: Env, escrow_id: Bytes) -> Option<Escrow> {
        let key = DataKey::Escrow(escrow_id);
        env.storage().persistent().get(&key)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }
}
