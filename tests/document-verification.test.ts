import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────
// HOISTED MOCKS
// ─────────────────────────────────────────────────────────
const { mockEventLog, mockAsset, mockAuditLog } = vi.hoisted(() => ({
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
}));

vi.mock('../src/config/prisma', () => ({
    default: {
        eventLog: mockEventLog,
        asset: mockAsset,
        auditLog: mockAuditLog,
        $transaction: vi.fn(async (cb) =>
            cb({ eventLog: mockEventLog, asset: mockAsset, auditLog: mockAuditLog })
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

const VALID_HASH = 'a'.repeat(128);

// ─────────────────────────────────────────────────────────
// DocumentVerificationFacet
// ─────────────────────────────────────────────────────────
describe('DocumentVerificationFacet.verifyByHash', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns verified:false when hash is too short', async () => {
        const result = await DocumentVerificationFacet.verifyByHash('abc123');
        expect(result.verified).toBe(false);
        expect(result.reason).toBeUndefined();
        expect(mockEventLog.findFirst).not.toHaveBeenCalled();
    });

    it('returns verified:false when hash contains non-hex characters', async () => {
        const result = await DocumentVerificationFacet.verifyByHash('z'.repeat(128));
        expect(result.verified).toBe(false);
        expect(result.reason).toBeUndefined();
    });

    it('returns verified:false when document not found', async () => {
        mockEventLog.findFirst.mockResolvedValue(null);

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);
        expect(result.verified).toBe(false);
        expect(result.reason).toBeUndefined();
        expect(mockEventLog.findFirst).toHaveBeenCalledWith({
            where: { documentHash: VALID_HASH },
            include: { asset: { select: { status: true } } },
        });
    });

    it('returns full proof when document is found', async () => {
        const now = new Date();
        mockEventLog.findFirst.mockResolvedValue({
            id: 'evt_001',
            assetId: 'asset_001',
            issuerId: 'qc_key_abc',
            dltTxId: 'ALGO-TX-xyz',
            updatedAt: now,
            asset: { status: 'ACTIVE' },
        });

        const result = await DocumentVerificationFacet.verifyByHash(VALID_HASH);
        expect(result.verified).toBe(true);
        expect(result).toMatchObject({
            assetId: 'asset_001',
            assetStatus: 'ACTIVE',
            dltTxId: 'ALGO-TX-xyz',
            anchoredAt: now,
            eventId: 'evt_001',
            issuerId: 'qc_key_abc',
        });
    });

    it('accepts uppercase hex hashes', async () => {
        mockEventLog.findFirst.mockResolvedValue(null);
        const result = await DocumentVerificationFacet.verifyByHash('A'.repeat(128));
        expect(result.reason).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────
// EventLogFacet — documentHash extraction
// ─────────────────────────────────────────────────────────
describe('EventLogFacet.recordAuthenticatedEvent — documentHash', () => {
    const secureCtx = { tenantId: 'tenant_001', role: 'ADMIN', apiKeyId: 'qc_key' };
    const asset = { id: 'asset_001', tenantId: 'tenant_001', status: 'ACTIVE' };

    beforeEach(() => {
        vi.clearAllMocks();
        mockAsset.findUnique.mockResolvedValue(asset);
        mockEventLog.create.mockResolvedValue({ id: 'evt_new', assetId: 'asset_001' });
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
            })
        );
    });

    it('saves documentHash as null when not provided', async () => {
        await EventLogFacet.recordAuthenticatedEvent(secureCtx, {
            assetId: 'asset_001',
            payload: { type: 'GENERIC' },
        });

        expect(mockEventLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ documentHash: null }),
            })
        );
    });

    it('throws when documentHash is not 128 hex chars', async () => {
        await expect(
            EventLogFacet.recordAuthenticatedEvent(secureCtx, {
                assetId: 'asset_001',
                documentHash: 'short-invalid-hash',
                payload: { type: 'EXPERT_REPORT' },
            })
        ).rejects.toThrow('Invalid documentHash');
    });
});
