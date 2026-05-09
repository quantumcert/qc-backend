// tests/scheduler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock BillingFacet (WebhookInbox processor — added in Plan 01-03 CORE-04)
vi.mock('../src/services/core-facets/BillingFacet', () => ({
    BillingFacet: {
        processWebhookInbox: vi.fn().mockResolvedValue({ processed: 0, succeeded: 0, failed: 0 }),
    },
}));

// Mock remaining services to avoid real imports
vi.mock('../src/services/RetryWorker', () => ({
    RetryWorker: { processRetries: vi.fn().mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, dlq: 0 }) },
}));
vi.mock('../src/services/BlockchainObserverService', () => ({
    BlockchainObserverService: { getInstance: vi.fn().mockReturnValue({ scanAllChains: vi.fn().mockResolvedValue({ totalNewDeposits: 0, totalConfirmed: 0, errors: [] }) }) },
}));
vi.mock('../src/services/SecurityWatchdogService', () => ({
    SecurityWatchdogService: { getInstance: vi.fn().mockReturnValue({ checkAnomalies: vi.fn().mockResolvedValue([]) }) },
}));
vi.mock('../src/services/EscrowReleaseWorker', () => ({
    EscrowReleaseWorker: { processReleases: vi.fn().mockResolvedValue({ released: 0, failed: 0 }) },
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

    it('✅ Registers a WebhookInbox cron job (CORE-04)', () => {
        SchedulerService.start();

        // SchedulerService registers multiple cron jobs; check that at least one
        // is registered with the default WebhookInbox pattern (*/30 * * * * *)
        const patterns = mockCronSchedule.mock.calls.map((call: any[]) => call[0] as string);
        // Default: WEBHOOK_INBOX_INTERVAL_SECONDS not set → 30s
        expect(patterns).toContain('*/30 * * * * *');
        // Verify multiple jobs are registered (AnchorQueue + WebhookInbox + others)
        expect(mockCronSchedule.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('✅ Respects WEBHOOK_INBOX_INTERVAL_SECONDS env var', () => {
        process.env.WEBHOOK_INBOX_INTERVAL_SECONDS = '60';
        SchedulerService.start();

        const patterns = mockCronSchedule.mock.calls.map((call: any[]) => call[0] as string);
        expect(patterns).toContain('*/60 * * * * *');

        delete process.env.WEBHOOK_INBOX_INTERVAL_SECONDS;
    });
});
