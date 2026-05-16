import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─────────────────────────────────────────────────────────
// HOISTED MOCKS
// ─────────────────────────────────────────────────────────
const { mockEventLog, mockAsset, mockAuditLog, mockChainTransaction } =
    vi.hoisted(() => ({
        mockEventLog: {
            create: vi.fn(),
            findFirst: vi.fn(),
        },
        mockAsset: {
            findUnique: vi.fn(),
        },
        mockAuditLog: {
            create: vi.fn(),
        },
        mockChainTransaction: {
            findFirst: vi.fn(),
        },
    }));

vi.mock('../src/config/prisma', () => ({
    default: {
        eventLog: mockEventLog,
        asset: mockAsset,
        auditLog: mockAuditLog,
        chainTransaction: mockChainTransaction,
        $transaction: vi.fn(async (cb) =>
            cb({
                eventLog: mockEventLog,
                asset: mockAsset,
                auditLog: mockAuditLog,
            }),
        ),
    },
}));

vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: { processQueue: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../src/utils/WebhookDispatcher', () => ({
    WebhookDispatcher: { dispatch: vi.fn() },
}));

import { DocumentVerificationFacet } from '../src/services/core-facets/DocumentVerificationFacet';
import { EventLogFacet } from '../src/services/core-facets/EventLogFacet';
import { FacetRegistry } from '../src/diamond/FacetRegistry';
import publicRoutes from '../src/routes/v1/publicRoutes';

const VALID_HASH = 'a'.repeat(128);

const createPublicApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/public', publicRoutes);
    return app;
};

// ─────────────────────────────────────────────────────────
// DocumentVerificationFacet
// ─────────────────────────────────────────────────────────
describe('DocumentVerificationFacet.verifyByHash', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns verified:false when hash is too short', async () => {
        const result = await DocumentVerificationFacet.verifyByHash('abc123');
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('INVALID_DOCUMENT_HASH');
        expect(mockEventLog.findFirst).not.toHaveBeenCalled();
        expect(mockChainTransaction.findFirst).not.toHaveBeenCalled();
    });

    it('returns verified:false when hash contains non-hex characters', async () => {
        const result = await DocumentVerificationFacet.verifyByHash(
            'z'.repeat(128),
        );
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('INVALID_DOCUMENT_HASH');
    });

    it('returns verified:false when document not found', async () => {
        mockEventLog.findFirst.mockResolvedValue(null);

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('DOCUMENT_NOT_FOUND');
        expect(mockEventLog.findFirst).toHaveBeenCalledWith({
            where: { documentHash: VALID_HASH },
            include: { asset: { select: { status: true, publicUrl: true } } },
        });
        expect(mockChainTransaction.findFirst).not.toHaveBeenCalled();
    });

    it('returns full proof with latest anchor metadata when document is found', async () => {
        const now = new Date();
        const confirmedAt = new Date(now.getTime() + 1000);
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_001',
            assetId: 'asset_001',
            issuerId: 'qc_key_abc',
            dltTxId: 'ALGO-TX-xyz',
            updatedAt: now,
            asset: {
                status: 'ACTIVE',
                publicUrl: 'https://verify.quantumcert.io/a/asset_001',
            },
        });
        mockChainTransaction.findFirst.mockResolvedValue({
            chain: 'ALGORAND',
            chainTxId: 'ALGO-TX-anchor',
            confirmedAt,
            status: 'CONFIRMED',
        });

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);
        expect(result.verified).toBe(true);
        expect(result).toMatchObject({
            assetId: 'asset_001',
            assetStatus: 'ACTIVE',
            publicUrl: 'https://verify.quantumcert.io/a/asset_001',
            dltTxId: 'ALGO-TX-anchor',
            chain: 'ALGORAND',
            anchoredAt: confirmedAt,
            blockchain: {
                dltTxId: 'ALGO-TX-anchor',
                explorerUrl: null,
                chain: 'ALGORAND',
                anchoredAt: confirmedAt,
            },
            eventId: 'evt_001',
            issuerId: 'qc_key_abc',
            confirmationStatus: 'CONFIRMED',
        });
        expect(mockChainTransaction.findFirst).toHaveBeenCalledWith({
            where: { txRef: 'evt_001', direction: 'ANCHOR' },
            orderBy: { createdAt: 'desc' },
        });
    });

    it('returns blockchain:null when there is no ChainTransaction proof', async () => {
        const now = new Date();
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_legacy',
            assetId: 'asset_legacy',
            issuerId: 'qc_key_abc',
            dltTxId: 'LEGACY-TX',
            updatedAt: now,
            asset: { status: 'ACTIVE', publicUrl: null },
        });
        mockChainTransaction.findFirst.mockResolvedValue(null);

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);

        expect(result.verified).toBe(true);
        expect(result.dltTxId).toBe('LEGACY-TX');
        expect(result.chain).toBeUndefined();
        expect(result.blockchain).toBeNull();
    });

    it('returns Stellar blockchain proof with Stellar Expert testnet explorer URL', async () => {
        const now = new Date();
        const confirmedAt = new Date(now.getTime() + 1000);
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_stellar',
            assetId: 'asset_stellar',
            issuerId: 'qc_key_stellar',
            dltTxId: null,
            updatedAt: now,
            asset: { status: 'ACTIVE', publicUrl: null },
        });
        mockChainTransaction.findFirst.mockResolvedValue({
            chain: 'STELLAR',
            chainTxId: 'STELLAR-TX',
            confirmedAt,
            status: 'CONFIRMED',
        });

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);

        expect(result.blockchain).toEqual({
            dltTxId: 'STELLAR-TX',
            explorerUrl:
                'https://stellar.expert/explorer/testnet/tx/STELLAR-TX',
            chain: 'STELLAR',
            anchoredAt: confirmedAt,
        });
        expect(result).not.toHaveProperty('stellarTxId');
        expect(result).not.toHaveProperty('stellarExplorerUrl');
    });

    it('keeps future chains in the blockchain object with explorerUrl null', async () => {
        const now = new Date();
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_solana',
            assetId: 'asset_solana',
            issuerId: null,
            dltTxId: null,
            updatedAt: now,
            asset: { status: 'ACTIVE', publicUrl: null },
        });
        mockChainTransaction.findFirst.mockResolvedValue({
            chain: 'SOLANA',
            chainTxId: 'SOLANA-TX',
            confirmedAt: null,
            status: 'PENDING',
        });

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);

        expect(result.blockchain).toEqual({
            dltTxId: 'SOLANA-TX',
            explorerUrl: null,
            chain: 'SOLANA',
            anchoredAt: now,
        });
    });

    it('is reachable through the document.verify Diamond selector', async () => {
        mockEventLog.findFirst.mockResolvedValue(null);

        const result = await FacetRegistry['document.verify'](
            {},
            { hash: VALID_HASH },
        );

        expect(result).toEqual({
            verified: false,
            reason: 'DOCUMENT_NOT_FOUND',
        });
        expect(mockEventLog.findFirst).toHaveBeenCalledWith({
            where: { documentHash: VALID_HASH },
            include: { asset: { select: { status: true, publicUrl: true } } },
        });
    });

    it('accepts uppercase hex hashes', async () => {
        mockEventLog.findFirst.mockResolvedValue(null);
        const result = await DocumentVerificationFacet.verifyByHash(
            'A'.repeat(128),
        );
        expect(result.reason).toBe('DOCUMENT_NOT_FOUND');
    });
});

// ─────────────────────────────────────────────────────────
// Public document verification route
// ─────────────────────────────────────────────────────────
describe('GET /api/v1/public/verify/document/:hash', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 with structured INVALID_DOCUMENT_HASH for malformed hashes', async () => {
        const response = await request(createPublicApp()).get(
            '/api/v1/public/verify/document/not-a-valid-hash',
        );

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            success: false,
            error: 'Invalid document hash: must be a 128-character SHA3-512 hex string.',
            code: 'INVALID_DOCUMENT_HASH',
        });
        expect(mockEventLog.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 with structured DOCUMENT_NOT_FOUND when hash is absent', async () => {
        mockEventLog.findFirst.mockResolvedValue(null);

        const response = await request(createPublicApp()).get(
            `/api/v1/public/verify/document/${VALID_HASH}`,
        );

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
            success: false,
            error: 'Document not found.',
            code: 'DOCUMENT_NOT_FOUND',
        });
    });

    it('returns a flat public proof and excludes private fields', async () => {
        const now = new Date();
        const confirmedAt = new Date(now.getTime() + 1000);
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_001',
            assetId: 'asset_001',
            issuerId: 'qc_key_abc',
            dltTxId: 'ALGO-TX-xyz',
            updatedAt: now,
            asset: {
                status: 'ACTIVE',
                publicUrl: 'https://verify.quantumcert.io/a/asset_001',
            },
        });
        mockChainTransaction.findFirst.mockResolvedValue({
            chain: 'ALGORAND',
            chainTxId: 'ALGO-TX-anchor',
            confirmedAt,
            status: 'CONFIRMED',
        });

        const response = await request(createPublicApp()).get(
            `/api/v1/public/verify/document/${VALID_HASH}`,
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            verified: true,
            assetId: 'asset_001',
            assetStatus: 'ACTIVE',
            publicUrl: 'https://verify.quantumcert.io/a/asset_001',
            dltTxId: 'ALGO-TX-anchor',
            chain: 'ALGORAND',
            anchoredAt: confirmedAt.toISOString(),
            blockchain: {
                dltTxId: 'ALGO-TX-anchor',
                explorerUrl: null,
                chain: 'ALGORAND',
                anchoredAt: confirmedAt.toISOString(),
            },
            eventId: 'evt_001',
            issuerId: 'qc_key_abc',
            confirmationStatus: 'CONFIRMED',
        });

        for (const forbidden of [
            'tenantId',
            'metadata',
            'owners',
            'payload',
            'signatureHash',
            'sdmMacKey',
            'writeKey',
            'apiKey',
            'stellarTxId',
            'stellarExplorerUrl',
        ]) {
            expect(response.body).not.toHaveProperty(forbidden);
        }
    });
});

// ─────────────────────────────────────────────────────────
// EventLogFacet — documentHash extraction
// ─────────────────────────────────────────────────────────
describe('EventLogFacet.recordAuthenticatedEvent — documentHash', () => {
    const secureCtx = {
        tenantId: 'tenant_001',
        role: 'ADMIN',
        apiKeyId: 'qc_key',
    };
    const asset = { id: 'asset_001', tenantId: 'tenant_001', status: 'ACTIVE' };

    beforeEach(() => {
        vi.clearAllMocks();
        mockAsset.findUnique.mockResolvedValue(asset);
        mockEventLog.findFirst.mockResolvedValue(null);
        mockEventLog.create.mockResolvedValue({
            id: 'evt_new',
            assetId: 'asset_001',
        });
        mockAuditLog.create.mockResolvedValue({});
    });

    it('saves documentHash when provided in payload', async () => {
        await EventLogFacet.recordAuthenticatedEvent(secureCtx, {
            assetId: 'asset_001',
            documentHash: VALID_HASH,
            payload: { type: 'EXPERT_REPORT' },
        });

        expect(mockEventLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ documentHash: VALID_HASH }),
            }),
        );
    });

    it('returns the existing tenant event for duplicate documentHash without duplicate side effects', async () => {
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_existing',
            documentHash: VALID_HASH,
            tenantId: 'tenant_001',
        });

        const result = await EventLogFacet.recordAuthenticatedEvent(secureCtx, {
            assetId: 'asset_001',
            documentHash: VALID_HASH,
            payload: { type: 'EXPERT_REPORT' },
        });

        expect(result).toMatchObject({ id: 'evt_existing' });
        expect(mockEventLog.findFirst).toHaveBeenCalledWith({
            where: { tenantId: asset.tenantId, documentHash: VALID_HASH },
        });
        expect(mockEventLog.create).not.toHaveBeenCalled();
        expect(mockAuditLog.create).not.toHaveBeenCalled();
    });

    it('saves documentHash as null when not provided', async () => {
        await EventLogFacet.recordAuthenticatedEvent(secureCtx, {
            assetId: 'asset_001',
            payload: { type: 'GENERIC' },
        });

        expect(mockEventLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ documentHash: null }),
            }),
        );
    });

    it('throws when documentHash is not 128 hex chars', async () => {
        await expect(
            EventLogFacet.recordAuthenticatedEvent(secureCtx, {
                assetId: 'asset_001',
                documentHash: 'short-invalid-hash',
                payload: { type: 'EXPERT_REPORT' },
            }),
        ).rejects.toThrow('Invalid documentHash');
    });
});
