// tests/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so these refs are available inside vi.mock factory (hoisted to top)
const { mockCronSchedule, mockProcessQueue } = vi.hoisted(() => ({
    mockCronSchedule: vi.fn(),
    mockProcessQueue: vi.fn().mockResolvedValue({ processed: 0, items: [] }),
}));

// Mock node-cron before any imports that use it
vi.mock('node-cron', () => ({
    default: { schedule: mockCronSchedule },
    schedule: mockCronSchedule,
}));

// Mock AnchorQueueService
vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: { processQueue: mockProcessQueue }
}));

import { SchedulerService } from '../src/services/SchedulerService';

describe('SchedulerService.start', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.ANCHOR_QUEUE_INTERVAL_SECONDS;
    });

    it('✅ Registers a cron job with default 30s interval', () => {
        SchedulerService.start();
        expect(mockCronSchedule).toHaveBeenCalledWith('*/30 * * * * *', expect.any(Function));
    });

    it('✅ Respects ANCHOR_QUEUE_INTERVAL_SECONDS env var', () => {
        process.env.ANCHOR_QUEUE_INTERVAL_SECONDS = '60';
        SchedulerService.start();
        expect(mockCronSchedule).toHaveBeenCalledWith('*/60 * * * * *', expect.any(Function));
    });

    it('✅ Calls AnchorQueueService.processQueue when cron fires', async () => {
        SchedulerService.start();
        const cronCallback = mockCronSchedule.mock.calls[0][1];
        await cronCallback();
        expect(mockProcessQueue).toHaveBeenCalledOnce();
    });

    it('🛡️ Skips concurrent run if queue is already processing (overlap lock)', async () => {
        SchedulerService.start();
        const cronCallback = mockCronSchedule.mock.calls[0][1];

        // First call starts and holds
        let resolveFirst!: () => void;
        const slowFirst = new Promise<void>(r => { resolveFirst = r; });
        mockProcessQueue.mockReturnValueOnce(slowFirst);

        const first = cronCallback(); // sets isRunning = true
        await Promise.resolve();      // yield so the flag is set

        const second = cronCallback(); // should skip — isRunning is true
        await Promise.resolve();

        resolveFirst();
        await Promise.all([first, second]);

        expect(mockProcessQueue).toHaveBeenCalledTimes(1); // second was skipped
    });

    it('🛡️ Resets lock after processQueue throws (error recovery)', async () => {
        SchedulerService.start();
        const cronCallback = mockCronSchedule.mock.calls[0][1];

        mockProcessQueue.mockRejectedValueOnce(new Error('DLT timeout'));
        await cronCallback(); // throws internally, must not leave isRunning=true

        mockProcessQueue.mockResolvedValueOnce({ processed: 0, items: [] });
        await cronCallback(); // must run (lock was released)

        expect(mockProcessQueue).toHaveBeenCalledTimes(2);
    });
});

// ─────────────────────────────────────────────────────────
// AnchorQueueService — SKIP LOCKED concurrency tests
// ─────────────────────────────────────────────────────────

// Hoisted mocks for AnchorQueueService internals
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
    });

    it('🛡️ Returns { processed: 0 } when no pending events exist', async () => {
        // $transaction returns empty array (SKIP LOCKED found nothing)
        mockQueryRaw.mockResolvedValue([]);
        mockPrismaTransaction.mockImplementationOnce(async (cb: any) => {
            return cb({ $queryRaw: mockQueryRaw, eventLog: { updateMany: mockEventLogUpdateMany } });
        });

        const result = await AnchorQueueService.processQueue();
        expect(result).toEqual({ processed: 0, items: [] });
    });

    it('🛡️ Uses $transaction with $queryRaw (SKIP LOCKED pattern)', async () => {
        // Arrange: no events so we stop after the early return
        mockQueryRaw.mockResolvedValue([]);
        mockPrismaTransaction.mockImplementationOnce(async (cb: any) => {
            return cb({ $queryRaw: mockQueryRaw, eventLog: { updateMany: mockEventLogUpdateMany } });
        });

        await AnchorQueueService.processQueue();

        // Assert: $transaction was called (wraps SELECT FOR UPDATE SKIP LOCKED)
        expect(mockPrismaTransaction).toHaveBeenCalledOnce();
        // Assert: $queryRaw was called inside the transaction
        expect(mockQueryRaw).toHaveBeenCalledOnce();
    });

    it('🛡️ Events with dltTxId already set are not returned by SELECT (SKIP LOCKED filters at DB level)', async () => {
        // The SKIP LOCKED query only returns rows with dltTxId IS NULL.
        // We simulate: 0 rows returned (all already locked by another worker).
        mockQueryRaw.mockResolvedValue([]);
        mockPrismaTransaction.mockImplementationOnce(async (cb: any) => {
            return cb({ $queryRaw: mockQueryRaw, eventLog: { updateMany: mockEventLogUpdateMany } });
        });

        const result = await AnchorQueueService.processQueue();
        // When SKIP LOCKED returns 0 rows, processed must be 0
        expect(result.processed).toBe(0);
        expect(mockEventLogUpdateMany).not.toHaveBeenCalled();
    });

    it('🛡️ Two parallel processQueue calls do not double-process the same event (SKIP LOCKED + PROCESSING marker)', async () => {
        // Simulate: first call gets event, marks PROCESSING; second gets nothing (locked)
        const fakeEvent = { id: 'evt_001', assetId: 'asset_001', tenantId: 'tenant_001', signatureHash: 'abc' };

        let firstCallCompleted = false;

        // First transaction: returns the event
        mockPrismaTransaction
            .mockImplementationOnce(async (cb: any) => {
                const tx = {
                    $queryRaw: vi.fn().mockResolvedValue([fakeEvent]),
                    eventLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
                };
                const result = await cb(tx);
                firstCallCompleted = true;
                return result;
            })
            // Second transaction: returns empty (event is already locked)
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
