/**
 * Shared parameter interfaces and enums for all multi-chain DLT adapters.
 * Re-exported from IDLTAdapter for convenience.
 */

export {
  AnchorMode,
  AnchorOptions,
  EscrowParams,
  TransferParams,
  ReceiveParams,
  IDLTAdapter,
} from '../../interfaces/IDLTAdapter';

/**
 * Status of an escrow record in the database.
 */
export enum EscrowStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/**
 * Direction of a chain transaction for logging.
 */
export enum ChainTransactionDirection {
  SEND = 'SEND',
  RECEIVE = 'RECEIVE',
  ESCROW_CREATE = 'ESCROW_CREATE',
  ESCROW_RELEASE = 'ESCROW_RELEASE',
  ESCROW_CANCEL = 'ESCROW_CANCEL',
  ANCHOR = 'ANCHOR',
}

/**
 * Generic result wrapper for adapter operations.
 */
export interface AdapterResult<T = string> {
  success: boolean;
  txId?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

