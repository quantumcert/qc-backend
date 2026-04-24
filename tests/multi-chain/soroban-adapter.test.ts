import { describe, it, expect, vi } from 'vitest';

// ── Module mocks (self-contained factories — no external refs) ──

vi.mock('../../src/config/prisma', () => ({
    default: {
        chainTransaction: { create: vi.fn().mockResolvedValue({}) },
    },
}));

// ── Env vars (must be set before importing adapter) ─────────

process.env.STELLAR_HORIZON_URL = 'https://fake-horizon.stellar.org';
process.env.STELLAR_SOROBAN_RPC_URL = 'https://fake-soroban.stellar.org';
process.env.STELLAR_AUTHORITY_SECRET_KEY = 'S'.padEnd(56, 'A');
process.env.STELLAR_ANCHOR_CONTRACT_ID = 'CA7VBJVNTVMFFH2E3QNOZT3X3ZTUHX7ZYMX6PYFDYD3CFWGZMQHFKJGI';

// ── Import adapter after mocks ──────────────────────────────

import { SorobanAdapter } from '../../src/services/multi-chain/SorobanAdapter';

describe('SorobanAdapter', () => {
    it('✅ instantiates with required env vars', () => {
        const adapter = new SorobanAdapter();
        expect(adapter).toBeDefined();
    });

    it('🚫 throws if STELLAR_HORIZON_URL is missing', () => {
        const original = process.env.STELLAR_HORIZON_URL;
        delete process.env.STELLAR_HORIZON_URL;
        expect(() => new SorobanAdapter()).toThrow('STELLAR_HORIZON_URL');
        process.env.STELLAR_HORIZON_URL = original;
    });

    it('✅ anchorEvent returns a tx hash', async () => {
        const adapter = new SorobanAdapter();
        const hash64 = 'a3f5c8e9b2d1f4a7e6c3b8d5a2f1e4c7b6a3d8f5e2c1b4a7f6e3d8c5b2a1f4ee';
        const txId = await adapter.anchorEvent('evt_001', hash64);
        expect(txId).toBe('fake_soroban_hash');
    });

    it('✅ verifyAnchor returns true for SUCCESS tx', async () => {
        const adapter = new SorobanAdapter();
        const result = await adapter.verifyAnchor('fake_soroban_hash');
        expect(result).toBe(true);
    });

    it('✅ createEscrow returns a tx hash', async () => {
        const adapter = new SorobanAdapter();
        const txId = await adapter.createEscrow({
            escrowId: 'esc_001',
            sender: 'FAKESTELLARPUBKEY',
            receiver: 'FAKESTELLARPUBKEY',
            amount: '10000000',
            unlockTimestamp: 1893456000,
        });
        expect(txId).toBe('fake_soroban_hash');
    });

    it('✅ releaseEscrow returns a tx hash', async () => {
        const adapter = new SorobanAdapter();
        const txId = await adapter.releaseEscrow('esc_001', 'tx_ref_001');
        expect(txId).toBe('fake_soroban_hash');
    });

    it('✅ cancelEscrow returns a tx hash', async () => {
        const adapter = new SorobanAdapter();
        const txId = await adapter.cancelEscrow('esc_001', 'tx_ref_001');
        expect(txId).toBe('fake_soroban_hash');
    });

    it('✅ sendAsset returns a tx hash', async () => {
        const adapter = new SorobanAdapter();
        const txId = await adapter.sendAsset({
            to: 'FAKESTELLARPUBKEY',
            amount: '10',
            txRef: 'tx_ref_002',
        });
        expect(txId).toBe('fake_stellar_hash');
    });

    it('✅ receiveAsset returns a receive reference', async () => {
        const adapter = new SorobanAdapter();
        const result = await adapter.receiveAsset({
            from: 'FAKESTELLARPUBKEY',
            expectedAmount: '10',
            txRef: 'tx_ref_003',
        });
        expect(result).toMatch(/^RECEIVE_/);
    });
});
