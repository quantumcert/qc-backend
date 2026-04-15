// tests/dlt-adapter-factory.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─────────────────────────────────────────────────────────
// Mock algosdk so AlgorandAnchorFacet constructor does not
// require a real mnemonic or live Algorand node.
// ─────────────────────────────────────────────────────────
vi.mock('algosdk', () => ({
    default: {
        Algodv2: vi.fn().mockImplementation(() => ({})),
        mnemonicToSecretKey: vi.fn().mockReturnValue({
            addr: 'FAKEALGORANDADDRESS',
            sk: new Uint8Array(64),
        }),
    },
}));

// Mock Prisma so it never tries to open a DB connection
vi.mock('../src/config/prisma', () => ({
    default: {},
}));

// Mock PostQuantumCrypto so the import chain resolves cleanly
vi.mock('../src/utils/PostQuantumCrypto', () => ({
    PostQuantumCrypto: {
        signPayloadFalcon512: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    },
}));

// ─────────────────────────────────────────────────────────
// Set required env vars BEFORE importing DLTAdapterFactory
// (AlgorandAnchorFacet reads them at construction time)
// ─────────────────────────────────────────────────────────
beforeAll(() => {
    process.env.ALGORAND_MASTER_MNEMONIC = 'test mnemonic placeholder';
    process.env.ALGOD_SERVER = 'https://testnet-algorand.api.purestake.io/ps2';
});

import { DLTAdapterFactory } from '../src/services/DLTAdapterFactory';

describe('DLTAdapterFactory.getAdapter', () => {
    it('✅ Returns an IDLTAdapter for ALGORAND', () => {
        const adapter = DLTAdapterFactory.getAdapter('ALGORAND');

        expect(adapter).toBeDefined();
        expect(typeof adapter.anchorEvent).toBe('function');
        expect(typeof adapter.verifyAnchor).toBe('function');
    });

    it('🚫 Throws for SOLANA (not yet implemented)', () => {
        expect(() => DLTAdapterFactory.getAdapter('SOLANA' as any))
            .toThrow('DLT adapter not implemented for chain: SOLANA');
    });

    it('🚫 Throws for POLYGON (not yet implemented)', () => {
        expect(() => DLTAdapterFactory.getAdapter('POLYGON' as any))
            .toThrow('DLT adapter not implemented for chain: POLYGON');
    });

    it('✅ Returns a new instance per call (no singleton leak)', () => {
        const a = DLTAdapterFactory.getAdapter('ALGORAND');
        const b = DLTAdapterFactory.getAdapter('ALGORAND');
        expect(a).not.toBe(b);
    });
});
