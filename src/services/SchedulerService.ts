// src/services/SchedulerService.ts
import cron from 'node-cron';
import { AnchorQueueService } from './AnchorQueueService';

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
    }
}
