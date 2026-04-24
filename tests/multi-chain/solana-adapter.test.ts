import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@solana/web3.js', () => ({
    Connection: vi.fn().mockImplementation(() => ({
        getLatestBlockhash: vi.fn().mockResolvedValue({
            blockhash: 'fake_blockhash',
            lastValidBlockHeight: 999999,
        }),
        sendTransaction: vi.fn().mockResolvedValue('fake_solana_signature'),
        confirmTransaction: vi.fn().mockResolvedValue({}),
        getTransaction: vi.fn().mockResolvedValue({
            meta: { err: null },
            transaction: {
                message: {
                    compiledInstructions: [
                        { data: Buffer.concat([Buffer.alloc(24), Buffer.alloc(64)]) },
                    ],
                },
            },
        }),
    })),
    Keypair: {
        fromSecretKey: vi.fn().mockReturnValue({
            publicKey: {
                toBuffer: () => Buffer.alloc(32),
                toBase58: () => 'FakeSolanaPubkey',
            },
            secretKey: Buffer.alloc(64),
        }),
    },
    PublicKey: Object.assign(
        vi.fn().mockImplementation((key: string) => ({
            toBuffer: () => Buffer.alloc(32),
            toBase58: () => key,
            key,
        })),
        { findProgramAddressSync: vi.fn().mockReturnValue([{ toBase58: () => 'FakePda', toBuffer: () => Buffer.alloc(32) }]) }
    ) as any,
    TransactionMessage: vi.fn().mockImplementation(({ instructions }) => ({
        compileToV0Message: vi.fn().mockReturnValue({}),
    })),
    VersionedTransaction: vi.fn().mockImplementation(() => ({
        sign: vi.fn(),
    })),
    SystemProgram: {
        programId: { toBuffer: () => Buffer.alloc(32), toBase58: () => '11111111111111111111111111111111' },
        transfer: vi.fn().mockReturnValue({ programId: { toBase58: () => '11111111111111111111111111111111' } }),
    },
    LAMPORTS_PER_SOL: 1000000000,
}));

vi.mock('../../src/config/prisma', () => ({
    default: {
        chainTransaction: { create: vi.fn().mockResolvedValue({}) },
    },
}));

beforeAll(() => {
    process.env.SOLANA_RPC_URL = 'https://fake-solana.rpc';
    process.env.SOLANA_AUTHORITY_PRIVATE_KEY = Buffer.alloc(64).toString('base64');
    process.env.SOLANA_ANCHOR_PROGRAM_ID = 'FakeSolanaProgramId111111111111111111111111111';
});

import { SolanaAdapter } from '../../src/services/multi-chain/SolanaAdapter';

describe('SolanaAdapter', () => {
    it('✅ instantiates with required env vars', () => {
        const adapter = new SolanaAdapter();
        expect(adapter).toBeDefined();
    });

    it('🚫 throws if SOLANA_RPC_URL is missing', () => {
        const original = process.env.SOLANA_RPC_URL;
        delete process.env.SOLANA_RPC_URL;
        expect(() => new SolanaAdapter()).toThrow('SOLANA_RPC_URL');
        process.env.SOLANA_RPC_URL = original;
    });

    it('✅ anchorEvent (LOG mode) returns a signature', async () => {
        const adapter = new SolanaAdapter();
        const sig = await adapter.anchorEvent('evt_001', 'abcd1234'.padEnd(64, '0'));
        expect(sig).toBe('fake_solana_signature');
    });

    it('✅ anchorEvent (STATE mode) returns a signature', async () => {
        const adapter = new SolanaAdapter();
        const sig = await adapter.anchorEvent('evt_002', 'abcd1234'.padEnd(64, '0'), {
            mode: 'STATE',
            unlockTimestamp: 1893456000,
        });
        expect(sig).toBe('fake_solana_signature');
    });

    it('✅ verifyAnchor returns true for confirmed tx', async () => {
        const adapter = new SolanaAdapter();
        const result = await adapter.verifyAnchor('fake_solana_signature');
        expect(result).toBe(true);
    });

    it('✅ createEscrow returns a signature', async () => {
        const adapter = new SolanaAdapter();
        const sig = await adapter.createEscrow({
            escrowId: 'esc_001',
            sender: 'FakeSolanaPubkey',
            receiver: 'FakeSolanaPubkey',
            amount: '1.5',
            unlockTimestamp: 1893456000,
        });
        expect(sig).toBe('fake_solana_signature');
    });

    it('✅ releaseEscrow returns a signature', async () => {
        const adapter = new SolanaAdapter();
        const sig = await adapter.releaseEscrow('esc_001', 'tx_ref_001');
        expect(sig).toBe('fake_solana_signature');
    });

    it('✅ cancelEscrow returns a signature', async () => {
        const adapter = new SolanaAdapter();
        const sig = await adapter.cancelEscrow('esc_001', 'tx_ref_001');
        expect(sig).toBe('fake_solana_signature');
    });

    it('✅ sendAsset returns a signature', async () => {
        const adapter = new SolanaAdapter();
        const sig = await adapter.sendAsset({
            to: 'FakeSolanaPubkey',
            amount: '0.5',
            txRef: 'tx_ref_002',
        });
        expect(sig).toBe('fake_solana_signature');
    });

    it('✅ receiveAsset returns a receive reference', async () => {
        const adapter = new SolanaAdapter();
        const result = await adapter.receiveAsset({
            from: 'FakeSolanaPubkey',
            expectedAmount: '1.0',
            txRef: 'tx_ref_003',
        });
        expect(result).toMatch(/^RECEIVE_/);
    });
});

