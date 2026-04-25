// ============================================================
// Multi-Chain Shared Types
// Centralizes type definitions used by multiple DLT adapters.
// ============================================================

export type ChainName = 'ALGORAND' | 'ETHEREUM' | 'POLYGON' | 'SOLANA' | 'STELLAR';

export interface ChainConfig {
  chain: ChainName;
  rpcUrl: string;
  nativeSymbol: string;
  decimals: number;
}

export interface PqcEmbeddedProof {
  /** Base64-encoded Falcon-512 signature */
  falconSig: string;
  /** Unix timestamp */
  timestamp: number;
  /** QTAG unique identifier */
  qtagId: string;
  /** Entity type: ASSET | EVENT | ESCROW | TRANSFER */
  entityType: string;
}

export interface HybridTxPayload {
  /** Classical DLT transaction hash */
  dltTxHash: string;
  /** Falcon-512 hash of the business payload */
  falconHash: string;
  /** Unix timestamp of anchoring */
  timestamp: number;
  /** QTAG identifier */
  qtagId: string;
  /** Entity type */
  entityType: string;
}

// ============================================================
// TRIPLE-SIGNATURE MULTI-SIG PROTOCOL
// Seller + Buyer + Quantum Intermediary (Falcon-512 Seal)
// ============================================================

export interface TripleSignature {
  /** Cryptographic proof of intent to sell/deliver (EdDSA/ECDSA) */
  sellerSig: string;
  /** Cryptographic proof of intent to buy/pay (EdDSA/ECDSA) */
  buyerSig: string;
  /** Quantum Cert master Falcon-512 seal validating the transaction */
  quantumSeal: string;
  /** Unix timestamp embedded within the Falcon-signed payload */
  shieldedTimestamp: number;
  /** SHA3-512 hash of the aggregated triple-signature data */
  aggregatedHash: string;
}

export interface TripleSignInput {
  /** Seller's wallet address */
  sellerAddress: string;
  /** Buyer's wallet address */
  buyerAddress: string;
  /** Asset amount in smallest denomination */
  amount: string;
  /** Asset/token contract address (null for native) */
  assetAddress?: string;
  /** Unique transaction/escrow identifier */
  txRef: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface TripleSignPayload {
  /** The three signatures aggregated */
  signatures: TripleSignature;
  /** The original input data that was signed */
  payload: TripleSignInput;
  /** Quantum Cert validation status */
  quantumValidated: boolean;
  /** Timestamp of Quantum Cert validation */
  validatedAt: number;
}
