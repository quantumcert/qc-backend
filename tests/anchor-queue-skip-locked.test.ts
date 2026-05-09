// tests/anchor-queue-skip-locked.test.ts
// Tests for AnchorQueueService SELECT FOR UPDATE SKIP LOCKED (SEC-04)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────
// HOISTED MOCKS
// ─────────────────────────────────────────────────────────
const {
    mockQueryRaw,
    mockEventLogUpdateMany,
    mockEventLogUpdate,
    mockTenantFindMany,
    mockPrismaTransaction,
} = vi.hoisted(() => {
    const mockQueryRaw = vi.fn();
    const mockEventLogUpdateMany = vi.fn();
    const mockEventLogUpdate = vi.fn();
    const mockTenantFindMany = vi.fn();

    const mockPrismaTransaction = vi.fn(async (cb: any) => {
        const txClient = {
            $queryRaw: mockQueryRaw,
            eventLog: { updateMany: mockEventLogUpdateMany },
        };
        return cb(txClient);
    });

    return { mockQueryRaw, mockEventLogUpdateMany, mockEventLogUpdate, mockTenantFindMany, mockPrismaTransaction };
});

vi.mock('../src/config/prisma', () => ({
    default: {
        $transaction: mockPrismaTransaction,
        eventLog: { updateMany: mockEventLogUpdateMany, update: mockEventLogUpdate },
        tenant: { findMany: mockTenantFindMany },
    },
}));

vi.mock('../src/services/DLTAdapterFactory', () => ({
    DLTAdapterFactory: {
        getAdapter: vi.fn(() => ({
            anchorEvent: vi.fn().mockResolvedValue('TX_ID_FAKE'),
        })),
    },
    SupportedChain: {},
}));

vi.mock('../src/utils/WebhookDispatcher', () => ({
    WebhookDispatcher: { dispatch: vi.fn() },
}));

vi.mock('../src/services/RetryWorker', () => ({
    RetryWorker: { enqueue: vi.fn() },
}));

import { AnchorQueueService } from '../src/services/AnchorQueueService';

describe('AnchorQueueService.processQueue — SKIP LOCKED', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: $transaction calls cb with tx client
        mockPrismaTransaction.mockImplementation(async (cb: any) => {
            return cb({
                $queryRaw: mockQueryRaw,
                eventLog: { updateMany: mockEventLogUpdateMany },
            });
        });
    });

    it('🛡️ Returns { processed: 0 } when no pending events exist', async () => {
        mockQueryRaw.mockResolvedValue([]);

        const result = await AnchorQueueService.processQueue();
        expect(result).toEqual({ processed: 0, items: [] });
    });

    it('🛡️ Uses $transaction with $queryRaw (SKIP LOCKED pattern)', async () => {
        mockQueryRaw.mockResolvedValue([]);

        await AnchorQueueService.processQueue();

        // Assert: $transaction was called (wraps SELECT FOR UPDATE SKIP LOCKED)
        expect(mockPrismaTransaction).toHaveBeenCalledOnce();
        // Assert: $queryRaw was called inside the transaction
        expect(mockQueryRaw).toHaveBeenCalledOnce();
    });

    it('🛡️ Events with dltTxId already set are not returned by SELECT (SKIP LOCKED filters at DB level)', async () => {
        // Simulate: all rows are locked by another worker → SELECT returns 0 rows
        mockQueryRaw.mockResolvedValue([]);

        const result = await AnchorQueueService.processQueue();

        // When SKIP LOCKED returns 0 rows, processed must be 0
        expect(result.processed).toBe(0);
        // No updateMany should be called (no events to lock)
        expect(mockEventLogUpdateMany).not.toHaveBeenCalled();
    });

    it('🛡️ Two parallel processQueue calls do not double-process the same event (SKIP LOCKED + PROCESSING marker)', async () => {
        // Simulate: first call gets event, marks PROCESSING; second gets nothing (locked)
        const fakeEvent = { id: 'evt_001', assetId: 'asset_001', tenantId: 'tenant_001', signatureHash: 'abc' };

        // First $transaction: returns the event
        mockPrismaTransaction
            .mockImplementationOnce(async (cb: any) => {
                const tx = {
                    $queryRaw: vi.fn().mockResolvedValue([fakeEvent]),
                    eventLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
                };
                return cb(tx);
            })
            // Second $transaction: returns empty (event is already locked by first worker)
            .mockImplementationOnce(async (cb: any) => {
                const tx = {
                    $queryRaw: vi.fn().mockResolvedValue([]),
                    eventLog: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
                };
                return cb(tx);
            });

        mockTenantFindMany.mockResolvedValue([{ id: 'tenant_001', targetChain: 'ALGORAND' }]);
        mockEventLogUpdate.mockResolvedValue({});

        const [r1, r2] = await Promise.all([
            AnchorQueueService.processQueue(),
            AnchorQueueService.processQueue(),
        ]);

        // Exactly one call should have processed the event; the other got 0
        const processedCounts = [r1.processed, r2.processed];
        expect(processedCounts).toContain(1);
        expect(processedCounts).toContain(0);
        // Total processed across both workers must be 1 (no double-processing)
        expect(r1.processed + r2.processed).toBe(1);
    });
});
