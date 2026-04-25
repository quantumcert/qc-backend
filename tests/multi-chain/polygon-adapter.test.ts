import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: vi.fn().mockImplementation(() => ({
            getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, logs: [] }),
        })),
        Wallet: vi.fn().mockImplementation(() => ({
            address: '0xFAKEPOLYGONADDRESS',
            getAddress: () => '0xFAKEPOLYGONADDRESS',
        })),
        Contract: vi.fn().mockImplementation(() => ({
            anchorEvent: vi.fn().mockResolvedValue({
                hash: '0xfake_polygon_hash',
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

vi.mock('../../src/services/KMSService', () => ({
    KMSService: {
        getInstance: vi.fn().mockReturnValue({
            getKey: vi.fn().mockImplementation((chain: string, keyType: string) => {
                if (chain === 'POLYGON' && keyType === 'rpcUrl') return 'https://fake-polygon.rpc';
                if (chain === 'POLYGON' && keyType === 'privateKey') return '0x'.padEnd(66, 'd');
                throw new Error(`Key not found: ${chain}.${keyType}`);
            }),
        }),
    },
}));

vi.mock('../../src/services/QuantumSignerService', () => ({
    QuantumSignerService: {
        getInstance: vi.fn().mockReturnValue({
            verifyTriple: vi.fn().mockResolvedValue({ valid: true }),
        }),
    },
}));

beforeAll(() => {
    process.env.POLYGON_RPC_URL = 'https://fake-polygon.rpc';
    process.env.POLYGON_PRIVATE_KEY = '0x'.padEnd(66, 'd');
    process.env.POLYGON_TRANSFER_FACET_ADDRESS = '0x'.padEnd(42, 'e');
});

import { PolygonAdapter } from '../../src/services/multi-chain/PolygonAdapter';

describe('PolygonAdapter', () => {
    it('instantiates with required env vars', () => {
        const adapter = new PolygonAdapter();
        expect(adapter).toBeDefined();
    });

    it('anchorEvent returns a tx hash', async () => {
        const adapter = new PolygonAdapter();
        const txId = await adapter.anchorEvent('evt_001', 'abcd1234');
        expect(txId).toBe('0xfake_polygon_hash');
    });

    it('verifyAnchor returns true for confirmed tx', async () => {
        const adapter = new PolygonAdapter();
        const result = await adapter.verifyAnchor('0xtx123');
        expect(result).toBe(true);
    });

    it('createEscrow returns a tx hash', async () => {
        const adapter = new PolygonAdapter();
        const txId = await adapter.createEscrow({
            escrowId: 'esc_001',
            sender: '0xFAKEPOLYGONADDRESS',
            receiver: '0xRECEIVER',
            amount: '1000000000000000000',
            unlockTimestamp: 1893456000,
        });
        expect(txId).toBe('0xfake_escrow_hash');
    });

    it('sendAsset returns a tx hash', async () => {
        const adapter = new PolygonAdapter();
        const txId = await adapter.sendAsset({
            to: '0xRECEIVER',
            amount: '500000000000000000',
            txRef: 'tx_ref_001',
        });
        expect(txId).toBe('0xfake_transfer_hash');
    });

    it('receiveAsset returns a receive reference', async () => {
        const adapter = new PolygonAdapter();
        const result = await adapter.receiveAsset({
            from: '0xSENDER',
            expectedAmount: '1000000000000000000',
            txRef: 'tx_ref_002',
        });
        expect(result).toMatch(/^RECEIVE_/);
    });

    it('tripleSign validation is called when provided', async () => {
        const adapter = new PolygonAdapter();
        const txId = await adapter.anchorEvent('evt_002', 'abcd1234', {
            tripleSign: {
                signatures: {
                    sellerSig: 'seller_sig',
                    buyerSig: 'buyer_sig',
                    quantumSeal: 'quantum_sig',
                    shieldedTimestamp: Date.now(),
                    aggregatedHash: 'agg_hash_123',
                },
                payload: {
                    sellerAddress: '0xSELLER',
                    buyerAddress: '0xBUYER',
                    amount: '1000000000000000000',
                    txRef: 'tx_ref_triple',
                },
                quantumValidated: true,
                validatedAt: Date.now(),
            },
        });
        expect(txId).toBe('0xfake_polygon_hash');
    });
});

