// tests/curation-facet.test.ts
// TDD RED phase — 8 behavior tests for CurationFacet
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────
// HOISTED MOCKS
// ─────────────────────────────────────────────────────────
const {
    mockAsset,
    mockContributor,
    mockEventLog,
    mockPendingContribution,
} = vi.hoisted(() => ({
    mockAsset: {
        findUnique: vi.fn(),
    },
    mockContributor: {
        findUnique: vi.fn(),
    },
    mockEventLog: {
        create: vi.fn(),
    },
    mockPendingContribution: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../src/config/prisma', () => ({
    default: {
        asset: mockAsset,
        contributor: mockContributor,
        eventLog: mockEventLog,
        pendingContribution: mockPendingContribution,
        $transaction: vi.fn(async (cb) =>
            cb({
                asset: mockAsset,
                contributor: mockContributor,
                eventLog: mockEventLog,
                pendingContribution: mockPendingContribution,
            })
        ),
    },
}));

vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: { processQueue: vi.fn().mockResolvedValue({}) },
}));

import { CurationFacet } from '../src/services/core-facets/CurationFacet';
import { AnchorQueueService } from '../src/services/AnchorQueueService';

const MOCK_ASSET = { id: 'asset_001', tenantId: 'tenant_001', status: 'ACTIVE' };
const MOCK_AUDITOR_CONTRIBUTOR = { tenantId: 'tenant_001', ownerRef: '+5511999999999', isAuditor: true };
const MOCK_NON_AUDITOR_CONTRIBUTOR = { tenantId: 'tenant_001', ownerRef: 'user@example.com', isAuditor: false };
const MOCK_EVENT = { id: 'evt_001', assetId: 'asset_001', tenantId: 'tenant_001' };
const MOCK_PENDING = { id: 'pending_001', tenantId: 'tenant_001', assetId: 'asset_001', status: 'PENDING_APPROVAL', payload: { type: 'info' } };

const CTX_OPERATOR = { tenantId: 'tenant_001', role: 'OPERATOR', apiKeyId: 'key_001' };
const CTX_ADMIN    = { tenantId: 'tenant_001', role: 'ADMIN', apiKeyId: 'key_002' };
const CTX_READER   = { tenantId: 'tenant_001', role: 'READER', apiKeyId: 'key_003' };
const CTX_OTHER    = { tenantId: 'tenant_002', role: 'OPERATOR', apiKeyId: 'key_004' };

describe('CurationFacet.submitContribution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (AnchorQueueService.processQueue as any).mockResolvedValue({});
    });

    // Test 1: Auditor bypass — cria EventLog APPROVED diretamente
    it('Test 1: auditor bypass — cria EventLog APPROVED e retorna { queued: true, eventId }', async () => {
        mockAsset.findUnique.mockResolvedValue(MOCK_ASSET);
        mockContributor.findUnique.mockResolvedValue(MOCK_AUDITOR_CONTRIBUTOR);
        mockEventLog.create.mockResolvedValue(MOCK_EVENT);

        const result = await CurationFacet.submitContribution({
            assetId: 'asset_001',
            phone: '+5511999999999',
            payload: { type: 'info', notes: 'auditor note' },
        });

        expect(result.queued).toBe(true);
        expect(result.eventId).toBe('evt_001');
        expect(result.pendingId).toBeUndefined();
        expect(mockEventLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    assetId: 'asset_001',
                    tenantId: 'tenant_001',
                    status: 'APPROVED',
                }),
            })
        );
        expect(AnchorQueueService.processQueue).toHaveBeenCalled();
    });

    // Test 2: Non-auditor → cria PendingContribution PENDING_APPROVAL
    it('Test 2: não-auditor — cria PendingContribution PENDING_APPROVAL e retorna { queued: false, pendingId }', async () => {
        mockAsset.findUnique.mockResolvedValue(MOCK_ASSET);
        mockContributor.findUnique.mockResolvedValue(null); // não é auditor
        mockPendingContribution.create.mockResolvedValue(MOCK_PENDING);

        const result = await CurationFacet.submitContribution({
            assetId: 'asset_001',
            email: 'user@example.com',
            payload: { type: 'info' },
        });

        expect(result.queued).toBe(false);
        expect(result.pendingId).toBe('pending_001');
        expect(result.eventId).toBeUndefined();
        expect(mockPendingContribution.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'PENDING_APPROVAL',
                    ownerId: 'user@example.com',
                }),
            })
        );
        expect(mockEventLog.create).not.toHaveBeenCalled();
    });

    // Test 3: assetId inválido → throw ASSET_NOT_FOUND
    it('Test 3: assetId inexistente — throw ASSET_NOT_FOUND', async () => {
        mockAsset.findUnique.mockResolvedValue(null);

        await expect(
            CurationFacet.submitContribution({
                assetId: 'nonexistent',
                phone: '+5511999999999',
                payload: {},
            })
        ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND', httpStatus: 404 });
    });

    // Test 4: sem phone nem email → throw INVALID_PAYLOAD
    it('Test 4: sem phone nem email — throw INVALID_PAYLOAD', async () => {
        await expect(
            CurationFacet.submitContribution({
                assetId: 'asset_001',
                payload: {},
            })
        ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD', httpStatus: 400 });

        expect(mockAsset.findUnique).not.toHaveBeenCalled();
    });

    it('rejects invalid email before touching storage', async () => {
        await expect(
            CurationFacet.submitContribution({
                assetId: 'asset_001',
                email: 'invalid-email',
                payload: {},
            })
        ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD', httpStatus: 400 });

        expect(mockAsset.findUnique).not.toHaveBeenCalled();
    });

    it('rejects oversized payloads before touching storage', async () => {
        await expect(
            CurationFacet.submitContribution({
                assetId: 'asset_001',
                email: 'user@example.com',
                payload: { text: 'x'.repeat(10 * 1024 + 1) },
            })
        ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', httpStatus: 413 });

        expect(mockAsset.findUnique).not.toHaveBeenCalled();
    });
});

describe('CurationFacet.reviewContribution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (AnchorQueueService.processQueue as any).mockResolvedValue({});
    });

    // Test 5: READER → throw INSUFFICIENT_PERMISSIONS
    it('Test 5: READER recebe INSUFFICIENT_PERMISSIONS (403)', async () => {
        await expect(
            CurationFacet.reviewContribution(CTX_READER, {
                pendingId: 'pending_001',
                decision: 'APPROVED',
            })
        ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS', httpStatus: 403 });

        expect(mockPendingContribution.findFirst).not.toHaveBeenCalled();
    });

    // Test 6: cross-tenant → throw CONTRIBUTION_NOT_FOUND
    it('Test 6: cross-tenant — retorna CONTRIBUTION_NOT_FOUND', async () => {
        mockPendingContribution.findFirst.mockResolvedValue(null); // contribuição de outro tenant → null

        await expect(
            CurationFacet.reviewContribution(CTX_OTHER, {
                pendingId: 'pending_001',
                decision: 'APPROVED',
            })
        ).rejects.toMatchObject({ code: 'CONTRIBUTION_NOT_FOUND', httpStatus: 404 });
    });

    // Test 7: OPERATOR aprova → PendingContribution APPROVED + EventLog + AnchorQueue
    it('Test 7: OPERATOR aprova — status APPROVED, cria EventLog, dispara AnchorQueue', async () => {
        mockPendingContribution.findFirst.mockResolvedValue(MOCK_PENDING);
        mockPendingContribution.update.mockResolvedValue({ ...MOCK_PENDING, status: 'APPROVED' });
        mockEventLog.create.mockResolvedValue(MOCK_EVENT);

        const result = await CurationFacet.reviewContribution(CTX_OPERATOR, {
            pendingId: 'pending_001',
            decision: 'APPROVED',
        });

        expect(result.status).toBe('APPROVED');
        expect(result.eventId).toBe('evt_001');
        expect(AnchorQueueService.processQueue).toHaveBeenCalled();
    });

    // Test 8: OPERATOR rejeita com reason → status REJECTED, reviewedBy + reviewedAt registrados
    it('Test 8: OPERATOR rejeita — status REJECTED, reviewedBy e reviewedAt registrados', async () => {
        mockPendingContribution.findFirst.mockResolvedValue(MOCK_PENDING);
        mockPendingContribution.update.mockResolvedValue({
            ...MOCK_PENDING,
            status: 'REJECTED',
            reviewedBy: 'key_001',
            reviewedAt: new Date(),
        });

        const result = await CurationFacet.reviewContribution(CTX_OPERATOR, {
            pendingId: 'pending_001',
            decision: 'REJECTED',
            reason: 'Informação incorreta',
        });

        expect(result.status).toBe('REJECTED');
        expect(result.eventId).toBeUndefined();
        expect(mockPendingContribution.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'pending_001' },
                data: expect.objectContaining({
                    status: 'REJECTED',
                    reviewedBy: 'key_001',
                }),
            })
        );
        expect(AnchorQueueService.processQueue).not.toHaveBeenCalled();
    });
});
