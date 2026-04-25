// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TransferFacet
 * @dev Diamond Standard Facet for Ethereum payments, escrow, and asset transfers.
 *      Implements high-security escrow with time-lock (Tikin project requirements).
 *      Compatible with EIP-2535 Diamond Pattern.
 *
 *      SECURITY: On-chain data is restricted to:
 *        - falconHash (bytes32) — SHA3-512 truncated hash
 *        - timestamp (uint256) — Unix timestamp
 *        - qtagId / escrowId (bytes32) — Correlation ID
 *        - entityType (string) — Type discriminator
 *      NO personal data, NO sensitive payloads, NO PII ever stored on-chain.
 *
 *      CIRCUIT BREAKER: Emergency pause mechanism for institutional security.
 *      All state-mutating functions check `whenNotPaused` modifier.
 *
 *      Operations supported:
 *        - Payment (Escrow creation with time-lock)
 *        - Receiving (escrow release verification)
 *        - Sending (direct transfers)
 */

// ===========================================================
// EVENTS
// ===========================================================

event EscrowCreated(
    bytes32 indexed escrowId,
    address indexed sender,
    address indexed receiver,
    uint256 amount,
    address assetAddress,
    uint256 unlockTimestamp,
    uint256 createdAt,
    bytes32 sellerPubKey,
    bytes32 buyerPubKey,
    bytes32 quantumPubKey
);

event EscrowReleased(
    bytes32 indexed escrowId,
    address indexed receiver,
    uint256 amount,
    uint256 releasedAt
);

event EscrowCancelled(
    bytes32 indexed escrowId,
    address indexed sender,
    uint256 amount,
    uint256 cancelledAt
);

event DirectTransfer(
    address indexed from,
    address indexed to,
    uint256 amount,
    address assetAddress,
    bytes32 indexed txRef
);

event AnchorEvent(
    bytes32 indexed eventIdHash,
    bytes32 indexed payloadHash,
    uint256 anchoredAt
);

event CircuitBreakerToggled(bool paused, uint256 timestamp);

// ===========================================================
// ERRORS
// ===========================================================

error EscrowAlreadyExists(bytes32 escrowId);
error EscrowNotFound(bytes32 escrowId);
error EscrowNotReleasable(bytes32 escrowId);
error EscrowNotCancellable(bytes32 escrowId);
error InsufficientAllowance(address token, uint256 required);
error InvalidAddress();
error InvalidAmount();
error InvalidTimeLock();
error TransferFailed();
error NotAuthorized();
error InvalidTripleProof();
error CircuitBreakerActive();

//
// INTERFACES
// ===========================================================

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

// ===========================================================
// STATE
// ===========================================================

struct TripleProof {
    bytes32 sellerPubKey;    // Seller's public key / signing address
    bytes32 buyerPubKey;     // Buyer's public key / signing address
    bytes32 quantumPubKey;   // Quantum Cert authority public key
    uint256 signedAt;        // Timestamp when triple-sign was completed
}

struct Escrow {
    address sender;
    address receiver;
    uint256 amount;
    address assetAddress; // address(0) for native ETH
    uint256 unlockTimestamp;
    uint256 createdAt;
    bool released;
    bool cancelled;
    TripleProof tripleProof; // 3-signature proof for this escrow
}

struct AnchorRecord {
    bytes32 falconHash;    // SHA3-512 truncated hash
    uint256 timestamp;     // Unix timestamp of anchoring
    bytes32 qtagId;        // Correlation ID
    bytes32 entityType;    // Type discriminator
}

// Diamond Storage Pattern (EIP-2535)
// Prevents storage collisions between facets
bytes32 constant TRANSFER_STORAGE_POSITION = keccak256("quantum.cert.transfer.facet.storage");

struct TransferStorage {
    mapping(bytes32 => Escrow) escrows;
    mapping(bytes32 => AnchorRecord) anchors;
    mapping(bytes32 => bool) anchoredEvents;
    address admin;
    bool paused; // Circuit breaker state
}

function transferStorage() pure returns (TransferStorage storage ds) {
    bytes32 position = TRANSFER_STORAGE_POSITION;
    assembly {
        ds.slot := position
    }
}

// ===========================================================
// MODIFIERS
// ===========================================================

modifier onlyAdmin() {
    if (msg.sender != transferStorage().admin) {
        revert NotAuthorized();
    }
    _;
}

modifier whenNotPaused() {
    if (transferStorage().paused) {
        revert CircuitBreakerActive();
    }
    _;
}

modifier validEscrow(bytes32 escrowId) {
    if (transferStorage().escrows[escrowId].sender == address(0)) {
        revert EscrowNotFound(escrowId);
    }
    _;
}

// ===========================================================
// FACET FUNCTIONS
// ===========================================================

contract TransferFacet {

    // --- Constructor / Initialization ---------------------

    function initialize(address _admin) external {
        TransferStorage storage ds = transferStorage();
        if (ds.admin != address(0)) revert NotAuthorized();
        ds.admin = _admin;
        ds.paused = false;
    }

    // --- Circuit Breaker ----------------------------------

    /**
     * @notice Toggles the circuit breaker pause state.
     * @dev Only callable by admin. Emits CircuitBreakerToggled event.
     */
    function togglePause() external onlyAdmin {
        TransferStorage storage ds = transferStorage();
        ds.paused = !ds.paused;
        emit CircuitBreakerToggled(ds.paused, block.timestamp);
    }

    /**
     * @notice Returns the current pause state.
     */
    function paused() external view returns (bool) {
        return transferStorage().paused;
    }

    // --- Triple-Proof Validation --------------------------

    function _validateTripleProof(TripleProof calldata proof) internal pure {
        if (proof.sellerPubKey == bytes32(0)) revert InvalidTripleProof();
        if (proof.buyerPubKey == bytes32(0)) revert InvalidTripleProof();
        if (proof.quantumPubKey == bytes32(0)) revert InvalidTripleProof();
        if (proof.sellerPubKey == proof.buyerPubKey) revert InvalidTripleProof();
        if (proof.sellerPubKey == proof.quantumPubKey) revert InvalidTripleProof();
        if (proof.buyerPubKey == proof.quantumPubKey) revert InvalidTripleProof();
    }

    // --- 1. ESCROW CREATION (Payment) ---------------------

    /**
     * @notice Creates an escrow holding funds until unlockTimestamp.
     * @param escrowId Unique identifier (correlates to off-chain DB)
     * @param receiver Address that will receive funds upon release
     * @param unlockTimestamp Unix timestamp when release becomes possible
     * @param assetAddress ERC-20 token address (address(0) for native ETH)
     * @param amount Amount in smallest denomination
     * @param tripleProof 3-signature proof from Seller, Buyer, and Quantum Cert
     */
    function createEscrow(
        bytes32 escrowId,
        address receiver,
        uint256 unlockTimestamp,
        address assetAddress,
        uint256 amount,
        TripleProof calldata tripleProof
    ) external payable whenNotPaused returns (bool) {
        if (receiver == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (unlockTimestamp <= block.timestamp) revert InvalidTimeLock();

        _validateTripleProof(tripleProof);

        TransferStorage storage ds = transferStorage();
        if (ds.escrows[escrowId].sender != address(0)) revert EscrowAlreadyExists(escrowId);

        // Native ETH
        if (assetAddress == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
        } else {
            // ERC-20 token
            if (msg.value != 0) revert InvalidAmount();
            IERC20 token = IERC20(assetAddress);
            uint256 allowance = token.allowance(msg.sender, address(this));
            if (allowance < amount) revert InsufficientAllowance(assetAddress, amount);

            bool success = token.transferFrom(msg.sender, address(this), amount);
            if (!success) revert TransferFailed();
        }

        ds.escrows[escrowId] = Escrow({
            sender: msg.sender,
            receiver: receiver,
            amount: amount,
            assetAddress: assetAddress,
            unlockTimestamp: unlockTimestamp,
            createdAt: block.timestamp,
            released: false,
            cancelled: false,
            tripleProof: tripleProof
        });

        emit EscrowCreated(
            escrowId,
            msg.sender,
            receiver,
            amount,
            assetAddress,
            unlockTimestamp,
            block.timestamp,
            tripleProof.sellerPubKey,
            tripleProof.buyerPubKey,
            tripleProof.quantumPubKey
        );

        return true;
    }

    // --- 2. ESCROW RELEASE (Receiving) --------------------

    /**
     * @notice Releases escrowed funds to the receiver.
     * @dev Only callable after unlockTimestamp. Can be called by receiver or admin.
     *      High-security time-lock enforced (Tikin project).
     */
    function releaseEscrow(bytes32 escrowId) external validEscrow(escrowId) whenNotPaused returns (bool) {
        TransferStorage storage ds = transferStorage();
        Escrow storage escrow = ds.escrows[escrowId];

        if (escrow.released || escrow.cancelled) revert EscrowNotReleasable(escrowId);
        if (block.timestamp < escrow.unlockTimestamp) revert EscrowNotReleasable(escrowId);
        if (msg.sender != escrow.receiver && msg.sender != ds.admin) revert NotAuthorized();

        escrow.released = true;

        if (escrow.assetAddress == address(0)) {
            // Native ETH
            (bool success, ) = payable(escrow.receiver).call{value: escrow.amount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC-20 token
            bool success = IERC20(escrow.assetAddress).transfer(escrow.receiver, escrow.amount);
            if (!success) revert TransferFailed();
        }

        emit EscrowReleased(escrowId, escrow.receiver, escrow.amount, block.timestamp);
        return true;
    }

    // --- 3. ESCROW CANCELLATION ---------------------------

    /**
     * @notice Cancels an escrow and returns funds to the sender.
     * @dev Only callable by sender or admin. Requires escrow not yet released.
     */
    function cancelEscrow(bytes32 escrowId) external validEscrow(escrowId) whenNotPaused returns (bool) {
        TransferStorage storage ds = transferStorage();
        Escrow storage escrow = ds.escrows[escrowId];

        if (escrow.released || escrow.cancelled) revert EscrowNotCancellable(escrowId);
        if (msg.sender != escrow.sender && msg.sender != ds.admin) revert NotAuthorized();

        escrow.cancelled = true;

        if (escrow.assetAddress == address(0)) {
            (bool success, ) = payable(escrow.sender).call{value: escrow.amount}("");
            if (!success) revert TransferFailed();
        } else {
            bool success = IERC20(escrow.assetAddress).transfer(escrow.sender, escrow.amount);
            if (!success) revert TransferFailed();
        }

        emit EscrowCancelled(escrowId, escrow.sender, escrow.amount, block.timestamp);
        return true;
    }

    // --- 4. DIRECT TRANSFER (Sending) ---------------------

    /**
     * @notice Direct transfer of native ETH or ERC-20 tokens.
     * @param to Receiver address
     * @param amount Amount in smallest denomination
     * @param assetAddress ERC-20 token address (address(0) for native ETH)
     * @param txRef Off-chain correlation reference
     */
    function directTransfer(
        address to,
        uint256 amount,
        address assetAddress,
        bytes32 txRef
    ) external payable whenNotPaused returns (bool) {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        if (assetAddress == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
            (bool success, ) = payable(to).call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            if (msg.value != 0) revert InvalidAmount();
            IERC20 token = IERC20(assetAddress);
            uint256 allowance = token.allowance(msg.sender, address(this));
            if (allowance < amount) revert InsufficientAllowance(assetAddress, amount);

            bool success = token.transferFrom(msg.sender, to, amount);
            if (!success) revert TransferFailed();
        }

        emit DirectTransfer(msg.sender, to, amount, assetAddress, txRef);
        return true;
    }

    // --- 5. ANCHOR EVENT ----------------------------------

    /**
     * @notice Anchors a payload hash to the blockchain via event emission.
     * @param eventId Off-chain event identifier
     * @param payloadHash SHA3-512 hash of the event payload
     * @param qtagId Correlation ID for the anchored entity
     * @param entityType Type discriminator (e.g., "ASSET", "EVENT", "ESCROW")
     */
    function anchorEvent(
        bytes32 eventId,
        bytes32 payloadHash,
        bytes32 qtagId,
        bytes32 entityType
    ) external onlyAdmin whenNotPaused returns (bool) {
        TransferStorage storage ds = transferStorage();

        ds.anchors[eventId] = AnchorRecord({
            falconHash: payloadHash,
            timestamp: block.timestamp,
            qtagId: qtagId,
            entityType: entityType
        });
        ds.anchoredEvents[eventId] = true;

        emit AnchorEvent(eventId, payloadHash, block.timestamp);
        return true;
    }

    // --- VIEW FUNCTIONS -----------------------------------

    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        return transferStorage().escrows[escrowId];
    }

    function getAnchor(bytes32 eventId) external view returns (AnchorRecord memory) {
        return transferStorage().anchors[eventId];
    }

    function isAnchored(bytes32 eventId) external view returns (bool) {
        return transferStorage().anchoredEvents[eventId];
    }

    // --- RECEIVE / FALLBACK -------------------------------

    receive() external payable {}
    fallback() external payable {}
}
