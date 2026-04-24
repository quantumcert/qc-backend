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

// ─────────────────────────────────────────────────────────
// Mock ethers so EthAdapter constructor does not require
// a real private key or live Ethereum node.
// ─────────────────────────────────────────────────────────
vi.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: vi.fn().mockImplementation(() => ({})),
        Wallet: vi.fn().mockImplementation(() => ({
            address: '0xFAKEETHADDRESS',
            getAddress: () => '0xFAKEETHADDRESS',
        })),
        Contract: vi.fn().mockImplementation(() => ({
            anchorEvent: vi.fn().mockResolvedValue({ hash: '0xfake_tx_hash', wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 123 }) }),
            createEscrow: vi.fn().mockResolvedValue({ hash: '0xfake_escrow_hash', wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 123 }) }),
            releaseEscrow: vi.fn().mockResolvedValue({ hash: '0xfake_release_hash', wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 123 }) }),
            cancelEscrow: vi.fn().mockResolvedValue({ hash: '0xfake_cancel_hash', wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 123 }) }),
            directTransfer: vi.fn().mockResolvedValue({ hash: '0xfake_transfer_hash', wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 123 }) }),
            getAddress: vi.fn().mockResolvedValue('0xFACETADDRESS'),
        })),
        keccak256: vi.fn().mockReturnValue('0x'.padEnd(66, 'a')),
        zeroPadValue: vi.fn().mockReturnValue('0x'.padEnd(66, 'b')),
        getAddress: vi.fn().mockImplementation((a: string) => a),
        Interface: vi.fn().mockImplementation(() => ({ parseLog: vi.fn().mockReturnValue(null) })),
        toUtf8Bytes: vi.fn().mockReturnValue([]),
        ZeroAddress: '0x0000000000000000000000000000000000000000',
    },
}));

// ─────────────────────────────────────────────────────────
// Mock @solana/web3.js so SolanaAdapter constructor does not
// require a real keypair or live Solana node.
// ─────────────────────────────────────────────────────────
vi.mock('@solana/web3.js', () => ({
    Connection: vi.fn().mockImplementation(() => ({
        getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: 'fake_blockhash', lastValidBlockHeight: 999999 }),
        sendTransaction: vi.fn().mockResolvedValue('fake_solana_signature'),
        confirmTransaction: vi.fn().mockResolvedValue({}),
        getTransaction: vi.fn().mockResolvedValue(null),
    })),
    Keypair: {
        fromSecretKey: vi.fn().mockReturnValue({
            publicKey: { toBuffer: () => Buffer.alloc(32), toBase58: () => 'FakeSolanaPubkey' },
            secretKey: Buffer.alloc(64),
        }),
    },
    PublicKey: vi.fn().mockImplementation((key: string) => ({
        toBuffer: () => Buffer.alloc(32),
        toBase58: () => key,
        key,
    })) as any,
    TransactionMessage: vi.fn().mockImplementation(() => ({
        compileToV0Message: vi.fn().mockReturnValue({}),
    })),
    VersionedTransaction: vi.fn().mockImplementation(() => ({
        sign: vi.fn(),
    })),
    SystemProgram: {
        programId: { toBuffer: () => Buffer.alloc(32) },
        transfer: vi.fn().mockReturnValue({}),
    },
    LAMPORTS_PER_SOL: 1000000000,
}));

// PublicKey.findProgramAddressSync is patched inside the mock above



// Mock Prisma so it never tries to open a DB connection
vi.mock('../src/config/prisma', () => ({
    default: {
        chainTransaction: { create: vi.fn().mockResolvedValue({}) },
    },
}));

// Mock PostQuantumCrypto so the import chain resolves cleanly
vi.mock('../src/utils/PostQuantumCrypto', () => ({
    PostQuantumCrypto: {
        signPayloadFalcon512: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    },
}));

// ─────────────────────────────────────────────────────────
// Set required env vars BEFORE importing DLTAdapterFactory
// ─────────────────────────────────────────────────────────
beforeAll(() => {
    process.env.ALGORAND_MASTER_MNEMONIC = 'test mnemonic placeholder';
    process.env.ALGOD_SERVER = 'https://testnet-algorand.api.purestake.io/ps2';
    process.env.ETHEREUM_RPC_URL = 'https://fake-ethereum.rpc';
    process.env.ETHEREUM_PRIVATE_KEY = '0x'.padEnd(66, 'c');
    process.env.ETHEREUM_TRANSFER_FACET_ADDRESS = '0x'.padEnd(42, 'd');
    process.env.SOLANA_RPC_URL = 'https://fake-solana.rpc';
    process.env.SOLANA_AUTHORITY_PRIVATE_KEY = Buffer.alloc(64).toString('base64');
    process.env.SOLANA_ANCHOR_PROGRAM_ID = 'FakeSolanaProgramId111111111111111111111111111';
    process.env.STELLAR_HORIZON_URL = 'https://fake-horizon.stellar.org';
    process.env.STELLAR_SOROBAN_RPC_URL = 'https://fake-soroban.stellar.org';
    process.env.STELLAR_AUTHORITY_SECRET_KEY = 'S'.padEnd(56, 'A');
    process.env.STELLAR_ANCHOR_CONTRACT_ID = 'C'.padEnd(56, 'B');
});

import { DLTAdapterFactory } from '../src/services/DLTAdapterFactory';

describe('DLTAdapterFactory.getAdapter', () => {
    it('✅ Returns an IDLTAdapter for ALGORAND', () => {
        const adapter = DLTAdapterFactory.getAdapter('ALGORAND');

        expect(adapter).toBeDefined();
        expect(typeof adapter.anchorEvent).toBe('function');
        expect(typeof adapter.verifyAnchor).toBe('function');
    });

    it('✅ Returns an IDLTAdapter for ETHEREUM', () => {
        const adapter = DLTAdapterFactory.getAdapter('ETHEREUM');

        expect(adapter).toBeDefined();
        expect(typeof adapter.anchorEvent).toBe('function');
        expect(typeof adapter.createEscrow).toBe('function');
        expect(typeof adapter.sendAsset).toBe('function');
    });

    it('✅ Returns an IDLTAdapter for SOLANA', () => {
        const adapter = DLTAdapterFactory.getAdapter('SOLANA');

        expect(adapter).toBeDefined();
        expect(typeof adapter.anchorEvent).toBe('function');
        expect(typeof adapter.createEscrow).toBe('function');
        expect(typeof adapter.sendAsset).toBe('function');
    });

    it('✅ Returns an IDLTAdapter for STELLAR', () => {
        const adapter = DLTAdapterFactory.getAdapter('STELLAR');

        expect(adapter).toBeDefined();
        expect(typeof adapter.anchorEvent).toBe('function');
        expect(typeof adapter.createEscrow).toBe('function');
        expect(typeof adapter.sendAsset).toBe('function');
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
