// ============================================================
// Multi-Chain DLT Adapter Interface v3
// Supports anchoring, escrow, and asset transfers across
// Algorand, Ethereum, Polygon, Solana, and Stellar.
//
// HYBRID SIGNATURE MODEL:
//   - pqcProof: Falcon-512 signature (Quantum-Resistant identity)
//   - Classical DLT signature: ECDSA/EdDSA (transport layer only)
//
// TRIPLE-SIGNATURE MULTI-SIG PROTOCOL:
//   - sellerSig: Proof of intent to sell/deliver
//   - buyerSig: Proof of intent to buy/pay
//   - quantumSeal: Quantum Cert master Falcon-512 seal
// ============================================================

import { TripleSignPayload } from '../services/multi-chain/types';

export type AnchorMode = 'LOG' | 'STATE';

export interface AnchorOptions {
  /** Tenant that owns the anchored event; required for tenant-safe transaction logging. */
  tenantId?: string;
  /** Solana: Mode A (Instruction Data) or Mode B (PDA). Default: 'LOG'. */
  mode?: AnchorMode;
  /** Unix timestamp (seconds) for time-lock escrow. Server-side calculated. */
  unlockTimestamp?: number;
  /** Chain-specific metadata (fee priority, memo, gas settings, etc.). */
  metadata?: Record<string, unknown>;
  /** Falcon-512 PQC proof (Base64 encoded) for hybrid signature. */
  pqcProof?: string;
  /** Triple-Signature Multi-Sig payload (Seller + Buyer + Quantum). */
  tripleSign?: TripleSignPayload;
}

export interface EscrowParams {
  /** Unique identifier for the escrow (correlates to DB). */
  escrowId: string;
  /** Sender wallet address. */
  sender: string;
  /** Receiver wallet address. */
  receiver: string;
  /** Asset amount in smallest denomination. */
  amount: string;
  /** Optional asset/token contract address. Null for native currency. */
  assetAddress?: string;
  /** Unix timestamp (seconds) when escrow can be released. 0 = immediate. */
  unlockTimestamp: number;
  /** Falcon-512 PQC proof (Base64 encoded) for hybrid signature. */
  pqcProof?: string;
  /** Triple-Signature Multi-Sig payload (Seller + Buyer + Quantum). */
  tripleSign?: TripleSignPayload;
}

export interface TransferParams {
  /** Receiver wallet address. */
  to: string;
  /** Asset amount in smallest denomination. */
  amount: string;
  /** Optional asset/token contract address. Null for native currency. */
  assetAddress?: string;
  /** Correlation ID for transaction logging. */
  txRef: string;
  /** Falcon-512 PQC proof (Base64 encoded) for hybrid signature. */
  pqcProof?: string;
  /** Triple-Signature Multi-Sig payload (Seller + Buyer + Quantum). */
  tripleSign?: TripleSignPayload;
}

export interface ReceiveParams {
  /** Sender wallet address. */
  from: string;
  /** Asset amount expected in smallest denomination. */
  expectedAmount: string;
  /** Optional asset/token contract address. Null for native currency. */
  assetAddress?: string;
  /** Correlation ID for transaction logging. */
  txRef: string;
  /** Falcon-512 PQC proof (Base64 encoded) for hybrid signature. */
  pqcProof?: string;
  /** Triple-Signature Multi-Sig payload (Seller + Buyer + Quantum). */
  tripleSign?: TripleSignPayload;
}

export interface PqcParams {
  /** Base64-encoded Falcon-512 detached signature. */
  signature: string;
  /** Unix timestamp when signed. */
  timestamp: number;
  /** Entity identifier. */
  entityId: string;
  /** Entity type: ASSET | EVENT | ESCROW | TRANSFER. */
  entityType: string;
}

export interface IDLTAdapter {
  /**
   * Anchors an event payload hash to the blockchain/DLT.
   * @param eventId The local event ID
   * @param hash The SHA-256 hash of the payload (hex string for backward compat)
   * @param options Optional chain-specific anchoring parameters including pqcProof
   * @returns A promise resolving to the transaction ID (TxID) on the DLT
   */
  anchorEvent(eventId: string, hash: string, options?: AnchorOptions): Promise<string>;

  /**
   * Verifies if an anchor associated with a TxID is mathematically valid and exists on the ledger.
   * @param txId The transaction ID on the DLT
   * @param expectedHash Optional expected hash to verify against on-chain data
   */
  verifyAnchor(txId: string, expectedHash?: string): Promise<boolean>;

  /**
   * Creates an escrow holding funds/assets until conditions are met.
   * @param params Escrow creation parameters including optional pqcProof
   * @returns Transaction ID of the escrow creation
   */
  createEscrow(params: EscrowParams): Promise<string>;

  /**
   * Releases escrowed funds/assets to the receiver.
   * @param escrowId The escrow identifier
   * @param txRef Correlation ID for transaction logging
   * @returns Transaction ID of the release
   */
  releaseEscrow(escrowId: string, txRef: string): Promise<string>;

  /**
   * Cancels an escrow and returns funds/assets to the sender.
   * @param escrowId The escrow identifier
   * @param txRef Correlation ID for transaction logging
   * @returns Transaction ID of the cancellation
   */
  cancelEscrow(escrowId: string, txRef: string): Promise<string>;

  /**
   * Sends assets/tokens to a destination address (direct transfer).
   * @param params Transfer parameters including optional pqcProof
   * @returns Transaction ID of the transfer
   */
  sendAsset(params: TransferParams): Promise<string>;

  /**
   * Receives/verifies an incoming asset transfer.
   * @param params Receive parameters including optional pqcProof
   * @returns Transaction ID of the received transfer confirmation
   */
  receiveAsset(params: ReceiveParams): Promise<string>;
}
