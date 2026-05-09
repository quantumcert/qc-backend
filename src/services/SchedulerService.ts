// src/services/SchedulerService.ts
import cron from 'node-cron';
import { AnchorQueueService } from './AnchorQueueService';
import { RetryWorker } from './RetryWorker';
import { BlockchainObserverService } from './BlockchainObserverService';
import { SecurityWatchdogService } from './SecurityWatchdogService';
import { EscrowReleaseWorker } from './EscrowReleaseWorker';
import { BillingFacet } from './core-facets/BillingFacet';

function readCronIntervalSeconds(envName: string, defaultValue: number): number {
    const raw = process.env[envName] ?? String(defaultValue);
    const parsed = Number.parseInt(raw, 10);

    if (!Number.isInteger(parsed) || parsed < 5 || parsed > 59) {
        throw new Error(`${envName} must be an integer between 5 and 59 seconds`);
    }

    return parsed;
}

export class SchedulerService {
    /**
     * Registers all cron jobs. Called once after server startup.
     * Contains no business logic — only timing triggers.
     * Blockchain resolution happens inside AnchorQueueService per-event.
     */
    static start(): void {
        const intervalSeconds = readCronIntervalSeconds('ANCHOR_QUEUE_INTERVAL_SECONDS', 30);
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
        const retryInterval = readCronIntervalSeconds('RETRY_WORKER_INTERVAL_SECONDS', 15);
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
        const observerInterval = readCronIntervalSeconds('BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS', 30);
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
        const escrowInterval = readCronIntervalSeconds('ESCROW_RELEASE_INTERVAL_SECONDS', 30);
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

        // ─── WebhookInbox Processor Cron ────────────────────
        // Processes PENDING MercadoPago webhook inbox records.
        // T-03-04 mitigation: prevents unbounded growth of WebhookInbox table.
        let webhookInboxRunning = false;
        const webhookInboxInterval = readCronIntervalSeconds('WEBHOOK_INBOX_INTERVAL_SECONDS', 30);
        const webhookInboxPattern = `*/${webhookInboxInterval} * * * * *`;

        cron.schedule(webhookInboxPattern, async () => {
            if (webhookInboxRunning) {
                // TODO(OPS-03): substituir console.log por logger estruturado (Phase 4)
                console.log('[Scheduler] WebhookInbox already running, skipping this cycle.');
                return;
            }
            webhookInboxRunning = true;
            try {
                const result = await BillingFacet.processWebhookInbox();
                if (result.processed > 0) {
                    console.log(
                        `[Scheduler] WebhookInbox: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.processed} processed.`
                    );
                }
            } catch (err) {
                // TODO(OPS-03): substituir console.error por logger estruturado (Phase 4)
                console.error('[Scheduler] WebhookInbox error:', err);
            } finally {
                webhookInboxRunning = false;
            }
        });

        console.log(`[Scheduler] WebhookInbox cron started — interval: ${webhookInboxInterval}s (pattern: ${webhookInboxPattern})`);
    }
}
