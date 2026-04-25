// src/services/SchedulerService.ts
import cron from 'node-cron';
import { AnchorQueueService } from './AnchorQueueService';
import { RetryWorker } from './RetryWorker';

export class SchedulerService {
    /**
     * Registers all cron jobs. Called once after server startup.
     * Contains no business logic — only timing triggers.
     * Blockchain resolution happens inside AnchorQueueService per-event.
     */
    static start(): void {
        const intervalSeconds = parseInt(process.env.ANCHOR_QUEUE_INTERVAL_SECONDS ?? '30', 10);
        const cronPattern = `*/${intervalSeconds} * * * * *`;

        let isRunning = false;

        cron.schedule(cronPattern, async () => {
            if (isRunning) {
                console.log('[Scheduler] AnchorQueue already running, skipping this cycle.');
                return;
            }
            isRunning = true;
            try {
                await AnchorQueueService.processQueue();
            } catch (err) {
                console.error('[Scheduler] AnchorQueue error:', err);
            } finally {
                isRunning = false;
            }
        });

        console.log(`[Scheduler] AnchorQueue cron started — interval: ${intervalSeconds}s (pattern: ${cronPattern})`);

        // ─── Retry Worker Cron ──────────────────────────────
        // Runs every 15 seconds to process failed DLT transactions
        let retryRunning = false;
        const retryInterval = 15;
        const retryPattern = `*/${retryInterval} * * * * *`;

        cron.schedule(retryPattern, async () => {
            if (retryRunning) {
                console.log('[Scheduler] RetryWorker already running, skipping this cycle.');
                return;
            }
            retryRunning = true;
            try {
                const result = await RetryWorker.processRetries();
                if (result.processed > 0) {
                    console.log(`[Scheduler] RetryWorker: ${result.succeeded} succeeded, ${result.failed} failed, ${result.dlq} DLQ out of ${result.processed} processed.`);
                }
            } catch (err) {
                console.error('[Scheduler] RetryWorker error:', err);
            } finally {
                retryRunning = false;
            }
        });

        console.log(`[Scheduler] RetryWorker cron started — interval: ${retryInterval}s (pattern: ${retryPattern})`);
    }
}
