import type { SupportedChain } from '../services/DLTAdapterFactory';

export const DEFAULT_TENANT_TARGET_CHAIN = 'STELLAR' satisfies SupportedChain;

export const TENANT_TARGET_CHAINS = [
    'STELLAR',
    'SOLANA',
    'ALGORAND',
    'POLYGON',
    'ETHEREUM',
] as const satisfies readonly SupportedChain[];

export type TenantTargetChain = (typeof TENANT_TARGET_CHAINS)[number];

export function isTenantTargetChain(value: string): value is TenantTargetChain {
    return (TENANT_TARGET_CHAINS as readonly string[]).includes(value);
}
