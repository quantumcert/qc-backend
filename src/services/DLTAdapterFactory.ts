// src/services/DLTAdapterFactory.ts
import { IDLTAdapter } from '../interfaces/IDLTAdapter';
import { AlgorandAnchorFacet } from './core-facets/AlgorandAnchorFacet';
import { EthAdapter } from './multi-chain/EthAdapter';
import { SolanaAdapter } from './multi-chain/SolanaAdapter';
import { SorobanAdapter } from './multi-chain/SorobanAdapter';

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
            case 'ETHEREUM':
                return new EthAdapter();
            case 'SOLANA':
                return new SolanaAdapter();
            case 'STELLAR':
                return new SorobanAdapter();
            default:
                throw new Error(`DLT adapter not implemented for chain: ${targetChain}`);
        }
    }
}
