// src/services/DLTAdapterFactory.ts
import { IDLTAdapter } from '../interfaces/IDLTAdapter';
import { AlgorandAnchorFacet } from './core-facets/AlgorandAnchorFacet';

// Add new chains here as Sub-sistema 2 adapters are implemented.
// import { SolanaAdapter } from './adapters/SolanaAdapter';
// import { PolygonAdapter } from './adapters/PolygonAdapter';
// import { StellarAdapter } from './adapters/StellarAdapter';

export type SupportedChain = 'ALGORAND' | 'SOLANA' | 'POLYGON' | 'ETHEREUM' | 'STELLAR';

export class DLTAdapterFactory {
    /**
     * Returns the IDLTAdapter for the specified chain.
     * Called by AnchorQueueService per-batch — never in server startup.
     * AnchorQueueService and SchedulerService never instantiate adapters directly.
     */
    static getAdapter(targetChain: SupportedChain): IDLTAdapter {
        switch (targetChain) {
            case 'ALGORAND':
                return new AlgorandAnchorFacet();
            // case 'SOLANA':   return new SolanaAdapter();   // Sub-sistema 2
            // case 'POLYGON':  return new PolygonAdapter();  // Sub-sistema 2
            // case 'STELLAR':  return new StellarAdapter();  // Sub-sistema 2
            default:
                throw new Error(`DLT adapter not implemented for chain: ${targetChain}`);
        }
    }
}
