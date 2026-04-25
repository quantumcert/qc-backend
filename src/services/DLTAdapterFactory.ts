// ============================================================
// DLT ADAPTER FACTORY -- Singleton Multi-Chain Resolver
// Returns the correct IDLTAdapter for the specified blockchain.
//
// SECURITY: Adapters NEVER access .env directly.
// All keys are retrieved from KMSService at runtime (Custodial Model).
// ============================================================

import { IDLTAdapter } from '../interfaces/IDLTAdapter';
import { KMSService } from './KMSService';
import { AlgorandAdapter } from './multi-chain/AlgorandAdapter';
import { EthAdapter } from './multi-chain/EthAdapter';
import { PolygonAdapter } from './multi-chain/PolygonAdapter';
import { SolanaAdapter } from './multi-chain/SolanaAdapter';
import { SorobanAdapter } from './multi-chain/SorobanAdapter';

export type SupportedChain =
  | 'ALGORAND'
  | 'ETHEREUM'
  | 'POLYGON'
  | 'SOLANA'
  | 'STELLAR';

export class DLTAdapterFactory {
  private static instance: DLTAdapterFactory;

  private constructor() {}

  static getInstance(): DLTAdapterFactory {
    if (!DLTAdapterFactory.instance) {
      DLTAdapterFactory.instance = new DLTAdapterFactory();
    }
    return DLTAdapterFactory.instance;
  }

  /**
   * Returns the IDLTAdapter for the specified chain.
   * Called by AnchorQueueService and RetryWorker per-batch.
   * Each call returns a new adapter instance (stateless) but
   * the factory itself is a singleton.
   */
  static getAdapter(targetChain: SupportedChain): IDLTAdapter {
    switch (targetChain) {
      case 'ALGORAND':
        return new AlgorandAdapter();
      case 'ETHEREUM':
        return new EthAdapter();
      case 'POLYGON':
        try {
          const kms = KMSService.getInstance();
          kms.getKey('POLYGON', 'rpcUrl');
        } catch {
          throw new Error('DLT adapter not implemented for chain: POLYGON');
        }
        return new PolygonAdapter();
      case 'SOLANA':
        return new SolanaAdapter();
      case 'STELLAR':
        return new SorobanAdapter();
      default:
        throw new Error(`DLT adapter not implemented for chain: ${targetChain}`);
    }
  }
}

