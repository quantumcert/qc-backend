// tests/lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAsset, mockEventLog, mockTransaction } = vi.hoisted(() => {
    const mockAsset = {
        findUnique: vi.fn(),
        update: vi.fn(),
    };
    const mockEventLog = {
        create: vi.fn(),
    };
    const mockTransaction = vi.fn(async (cb: any) => cb({
        asset: mockAsset,
        eventLog: mockEventLog,
    }));

    return { mockAsset, mockEventLog, mockTransaction };
});

vi.mock('../src/config/prisma', () => ({
    default: {
        asset: mockAsset,
        eventLog: mockEventLog,
        $transaction: mockTransaction,
    }
}));

vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: {
        processQueue: vi.fn().mockResolvedValue({ processed: 0, items: [] }),
    }
}));

import { LifecycleFacet } from '../src/services/core-facets/LifecycleFacet';
import { AnchorQueueService } from '../src/services/AnchorQueueService';

const CTX_ADMIN    = { tenantId: 'tenant_001', apiKeyId: 'key_001', role: 'ADMIN' };
const CTX_OPERATOR = { tenantId: 'tenant_001', apiKeyId: 'key_001', role: 'OPERATOR' };

const DRAFT_ASSET     = { id: 'asset_001', tenantId: 'tenant_001', status: 'DRAFT' };
const ACTIVE_ASSET    = { ...DRAFT_ASSET, status: 'ACTIVE' };
const SUSPENDED_ASSET = { ...DRAFT_ASSET, status: 'SUSPENDED' };
const ESCROW_ASSET    = { ...DRAFT_ASSET, status: 'LOCKED_IN_ESCROW' };
const AWAITING_ASSET  = { ...DRAFT_ASSET, status: 'AWAITING_PAYMENT' };

describe('LifecycleFacet.transition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTransaction.mockImplementation(async (cb: any) => cb({
            asset: mockAsset,
            eventLog: mockEventLog,
        }));
    });

    it('✅ DRAFT → ACTIVE (OPERATOR allowed)', async () => {
        mockAsset.findUnique.mockResolvedValue(DRAFT_ASSET);
        mockAsset.update.mockResolvedValue({ ...DRAFT_ASSET, status: 'ACTIVE' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_001' });

        const result = await LifecycleFacet.transition(CTX_OPERATOR, {
            assetId: 'asset_001', targetState: 'ACTIVE', reason: 'activation'
        });

        expect(result.currentState).toBe('ACTIVE');
        expect(result.previousState).toBe('DRAFT');
        expect(mockAsset.update).toHaveBeenCalledWith({
            where: { id: 'asset_001' },
            data: { status: 'ACTIVE' }
        });
        expect(mockEventLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                origin: 'LIFECYCLE',
                status: 'APPROVED',
                signatureHash: expect.any(String),
                payload: expect.objectContaining({
                    eventType: 'LIFECYCLE_TRANSITION',
                    fromState: 'DRAFT',
                    toState: 'ACTIVE',
                    reason: 'activation',
                })
            })
        }));
        expect(AnchorQueueService.processQueue).toHaveBeenCalledWith({
            tenantId: 'tenant_001',
            assetId: 'asset_001',
        });
    });

    it('✅ ACTIVE → SUSPENDED (ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);
        mockAsset.update.mockResolvedValue({ ...ACTIVE_ASSET, status: 'SUSPENDED' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_002' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'SUSPENDED'
        });

        expect(result.currentState).toBe('SUSPENDED');
    });

    it('✅ SUSPENDED → ACTIVE (reactivation, ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(SUSPENDED_ASSET);
        mockAsset.update.mockResolvedValue({ ...SUSPENDED_ASSET, status: 'ACTIVE' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_003' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ACTIVE'
        });

        expect(result.currentState).toBe('ACTIVE');
    });

    it('✅ ACTIVE → BURNED (terminal, ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);
        mockAsset.update.mockResolvedValue({ ...ACTIVE_ASSET, status: 'BURNED' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_004' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'BURNED'
        });

        expect(result.currentState).toBe('BURNED');
        expect(mockAsset.update).toHaveBeenCalled();
    });

    it('✅ ACTIVE → ARCHIVED (ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);
        mockAsset.update.mockResolvedValue({ ...ACTIVE_ASSET, status: 'ARCHIVED' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_005' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ARCHIVED'
        });

        expect(result.currentState).toBe('ARCHIVED');
    });

    it('🚫 LOCKED_IN_ESCROW → any throws ASSET_LOCKED_IN_ESCROW (HTTP 423)', async () => {
        mockAsset.findUnique.mockResolvedValue(ESCROW_ASSET);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ACTIVE'
        })).rejects.toMatchObject({
            code: 'ASSET_LOCKED_IN_ESCROW',
            httpStatus: 423,
        });

        expect(mockAsset.update).not.toHaveBeenCalled();
        expect(mockEventLog.create).not.toHaveBeenCalled();
    });

    it('🚫 AWAITING_PAYMENT → ACTIVE throws STATE_TRANSITION_FORBIDDEN (HTTP 422)', async () => {
        mockAsset.findUnique.mockResolvedValue(AWAITING_ASSET);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ACTIVE'
        })).rejects.toMatchObject({
            code: 'STATE_TRANSITION_FORBIDDEN',
            httpStatus: 422,
        });
    });

    it('🚫 DRAFT → BURNED is not a valid transition (HTTP 422)', async () => {
        mockAsset.findUnique.mockResolvedValue(DRAFT_ASSET);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'BURNED'
        })).rejects.toMatchObject({
            code: 'STATE_TRANSITION_FORBIDDEN',
            httpStatus: 422,
        });
    });

    it('🚫 ACTIVE → ARCHIVED requires ADMIN — OPERATOR rejected (HTTP 403)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);

        await expect(LifecycleFacet.transition(CTX_OPERATOR, {
            assetId: 'asset_001', targetState: 'ARCHIVED'
        })).rejects.toMatchObject({
            code: 'INSUFFICIENT_ROLE_FOR_TRANSITION',
            httpStatus: 403,
        });

        expect(mockAsset.update).not.toHaveBeenCalled();
    });

    it('🚫 Asset not found throws ASSET_NOT_FOUND', async () => {
        mockAsset.findUnique.mockResolvedValue(null);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'nonexistent', targetState: 'ACTIVE'
        })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    });

    it('✅ EventLog payload includes reason: null when reason is omitted', async () => {
        mockAsset.findUnique.mockResolvedValue(DRAFT_ASSET);
        mockAsset.update.mockResolvedValue({ ...DRAFT_ASSET, status: 'ACTIVE' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_006' });

        await LifecycleFacet.transition(CTX_ADMIN, { assetId: 'asset_001', targetState: 'ACTIVE' });

        expect(mockEventLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                payload: expect.objectContaining({ reason: null })
            })
        }));
    });
});
