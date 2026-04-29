// src/services/SchedulerService.ts
import cron from 'node-cron';
import { AnchorQueueService } from './AnchorQueueService';
import { RetryWorker } from './RetryWorker';
import { BlockchainObserverService } from './BlockchainObserverService';
import { SecurityWatchdogService } from './SecurityWatchdogService';
import { EscrowReleaseWorker } from './EscrowReleaseWorker';

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

        // ─── Blockchain Observer Cron ───────────────────────
        // Scans chains for incoming stablecoin deposits
        let observerRunning = false;
        const observerInterval = parseInt(
            process.env.BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS ?? '30',
            10
        );
        const observerPattern = `*/${observerInterval} * * * * *`;

        cron.schedule(observerPattern, async () => {
            if (observerRunning) {
                console.log('[Scheduler] BlockchainObserver already running, skipping this cycle.');
                return;
            }
            observerRunning = true;
            try {
                const observer = BlockchainObserverService.getInstance();
                const result = await observer.scanAllChains();
                if (result.totalNewDeposits > 0 || result.totalConfirmed > 0) {
                    console.log(
                        `[Scheduler] BlockchainObserver: ${result.totalNewDeposits} new deposits, ` +
                        `${result.totalConfirmed} newly confirmed.`
                    );
                }
                if (result.errors.length > 0) {
                    console.error('[Scheduler] BlockchainObserver errors:', result.errors);
                }
            } catch (err) {
                console.error('[Scheduler] BlockchainObserver error:', err);
            } finally {
                observerRunning = false;
            }
        });

        console.log(`[Scheduler] BlockchainObserver cron started — interval: ${observerInterval}s (pattern: ${observerPattern})`);

        // ─── Security Watchdog Cron ─────────────────────────
        // Runs every 60 seconds to check for anomalies
        let watchdogRunning = false;
        const watchdogInterval = 60;
        const watchdogPattern = `*/${watchdogInterval} * * * * *`;

        cron.schedule(watchdogPattern, async () => {
            if (watchdogRunning) {
                console.log('[Scheduler] SecurityWatchdog already running, skipping this cycle.');
                return;
            }
            watchdogRunning = true;
            try {
                const watchdog = SecurityWatchdogService.getInstance();
                const anomalies = await watchdog.checkAnomalies();
                if (anomalies.length > 0) {
                    console.warn(
                        `[Scheduler] SecurityWatchdog: ${anomalies.length} anomalies detected. ` +
                        `Severities: ${anomalies.map(a => a.severity).join(', ')}`
                    );
                }
            } catch (err) {
                console.error('[Scheduler] SecurityWatchdog error:', err);
            } finally {
                watchdogRunning = false;
            }
        });

        console.log(`[Scheduler] SecurityWatchdog cron started — interval: ${watchdogInterval}s (pattern: ${watchdogPattern})`);

        // ─── Escrow Release Worker Cron ─────────────────────
        let escrowRunning = false;
        const escrowInterval = parseInt(process.env.ESCROW_RELEASE_INTERVAL_SECONDS ?? '60', 10);
        const escrowPattern = `*/${escrowInterval} * * * * *`;

        cron.schedule(escrowPattern, async () => {
            if (escrowRunning) {
                console.log('[Scheduler] EscrowRelease already running, skipping this cycle.');
                return;
            }
            escrowRunning = true;
            try {
                const result = await EscrowReleaseWorker.processReleases();
                if (result.released > 0 || result.failed > 0) {
                    console.log(
                        `[Scheduler] EscrowRelease: ${result.released} released, ${result.failed} failed.`
                    );
                }
            } catch (err) {
                console.error('[Scheduler] EscrowRelease error:', err);
            } finally {
                escrowRunning = false;
            }
        });

        console.log(`[Scheduler] EscrowRelease cron started — interval: ${escrowInterval}s (pattern: ${escrowPattern})`);
    }
}
