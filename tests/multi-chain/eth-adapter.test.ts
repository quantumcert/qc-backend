import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: vi.fn().mockImplementation(() => ({
            getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, logs: [] }),
        })),
        Wallet: vi.fn().mockImplementation(() => ({
            address: '0xFAKEETHADDRESS',
            getAddress: () => '0xFAKEETHADDRESS',
        })),
        Contract: vi.fn().mockImplementation(() => ({
            anchorEvent: vi.fn().mockResolvedValue({
                hash: '0xfake_anchor_hash',
                wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 123 }),
            }),
            createEscrow: vi.fn().mockResolvedValue({
                hash: '0xfake_escrow_hash',
                wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 124 }),
            }),
            releaseEscrow: vi.fn().mockResolvedValue({
                hash: '0xfake_release_hash',
                wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 125 }),
            }),
            cancelEscrow: vi.fn().mockResolvedValue({
                hash: '0xfake_cancel_hash',
                wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 126 }),
            }),
            directTransfer: vi.fn().mockResolvedValue({
                hash: '0xfake_transfer_hash',
                wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 127 }),
            }),
            getAddress: vi.fn().mockResolvedValue('0xFACETADDRESS'),
        })),
        keccak256: vi.fn().mockImplementation((data: string | Uint8Array) => '0x' + Buffer.from(data as any).toString('hex').padEnd(64, '0')),
        zeroPadValue: vi.fn().mockImplementation((val: string) => val.padEnd(66, '0')),
        getAddress: vi.fn().mockImplementation((a: string) => a),
        Interface: vi.fn().mockImplementation(() => ({
            parseLog: vi.fn().mockReturnValue({ name: 'AnchorEvent', args: { payloadHash: '0xabcdef' } }),
        })),
        toUtf8Bytes: vi.fn().mockImplementation((s: string) => Buffer.from(s)),
        ZeroAddress: '0x0000000000000000000000000000000000000000',
    },
}));

vi.mock('../../src/config/prisma', () => ({
    default: {
        chainTransaction: { create: vi.fn().mockResolvedValue({}) },
    },
}));

beforeAll(() => {
    process.env.ETHEREUM_RPC_URL = 'https://fake-ethereum.rpc';
    process.env.ETHEREUM_PRIVATE_KEY = '0x'.padEnd(66, 'c');
    process.env.ETHEREUM_TRANSFER_FACET_ADDRESS = '0x'.padEnd(42, 'd');
});

import { EthAdapter } from '../../src/services/multi-chain/EthAdapter';

describe('EthAdapter', () => {
    it('✅ instantiates with required env vars', () => {
        const adapter = new EthAdapter();
        expect(adapter).toBeDefined();
    });

    it('🚫 throws if ETHEREUM_RPC_URL is missing', () => {
        const original = process.env.ETHEREUM_RPC_URL;
        delete process.env.ETHEREUM_RPC_URL;
        expect(() => new EthAdapter()).toThrow('ETHEREUM_RPC_URL');
        process.env.ETHEREUM_RPC_URL = original;
    });

    it('✅ anchorEvent returns a tx hash', async () => {
        const adapter = new EthAdapter();
        const txId = await adapter.anchorEvent('evt_001', 'abcd1234');
        expect(txId).toBe('0xfake_anchor_hash');
    });

    it('✅ verifyAnchor returns true for confirmed tx', async () => {
        const adapter = new EthAdapter();
        const result = await adapter.verifyAnchor('0xtx123');
        expect(result).toBe(true);
    });

    it('✅ createEscrow returns a tx hash', async () => {
        const adapter = new EthAdapter();
        const txId = await adapter.createEscrow({
            escrowId: 'esc_001',
            sender: '0xFAKEETHADDRESS',
            receiver: '0xRECEIVER',
            amount: '1000000000000000000',
            assetAddress: undefined,
            unlockTimestamp: 1893456000,
        });
        expect(txId).toBe('0xfake_escrow_hash');
    });

    it('✅ releaseEscrow returns a tx hash', async () => {
        const adapter = new EthAdapter();
        const txId = await adapter.releaseEscrow('esc_001', 'tx_ref_001');
        expect(txId).toBe('0xfake_release_hash');
    });

    it('✅ cancelEscrow returns a tx hash', async () => {
        const adapter = new EthAdapter();
        const txId = await adapter.cancelEscrow('esc_001', 'tx_ref_001');
        expect(txId).toBe('0xfake_cancel_hash');
    });

    it('✅ sendAsset returns a tx hash', async () => {
        const adapter = new EthAdapter();
        const txId = await adapter.sendAsset({
            to: '0xRECEIVER',
            amount: '500000000000000000',
            txRef: 'tx_ref_002',
        });
        expect(txId).toBe('0xfake_transfer_hash');
    });

    it('✅ receiveAsset returns a receive reference', async () => {
        const adapter = new EthAdapter();
        const result = await adapter.receiveAsset({
            from: '0xSENDER',
            expectedAmount: '1000000000000000000',
            txRef: 'tx_ref_003',
        });
        expect(result).toMatch(/^RECEIVE_/);
    });
});

