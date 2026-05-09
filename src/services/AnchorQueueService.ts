// src/services/AnchorQueueService.ts
import prisma from '../config/prisma';
import { DLTAdapterFactory, SupportedChain } from './DLTAdapterFactory';
import { WebhookDispatcher } from '../utils/WebhookDispatcher';
import { RetryWorker } from './RetryWorker';

export class AnchorQueueService {
    /**
     * Processes the queue of APPROVED events that do not yet have a DLT TxID.
     * Groups events by tenant chain to minimize adapter instantiations per batch.
     * On failure, inserts into PendingTransaction for RetryWorker to handle.
     */
    static async processQueue() {
        // SELECT FOR UPDATE SKIP LOCKED inside $transaction — prevents double-processing
        // across rolling deploys and parallel workers.
        // The updateMany (dltTxId: 'PROCESSING') runs inside the SAME transaction as the
        // SELECT, converting the pessimistic lock into a persistent state marker before
        // the transaction commits (defense in depth).
        const pendingEvents = await prisma.$transaction(async (tx) => {
            const events = await tx.$queryRaw<Array<{
                id: string;
                assetId: string;
                tenantId: string;
                signatureHash: string;
            }>>`
                SELECT id, "assetId", "tenantId", "signatureHash"
                FROM "EventLog"
                WHERE status IN ('APPROVED', 'PENDING_FUNDS')
                  AND "dltTxId" IS NULL
                  AND "signatureHash" IS NOT NULL
                ORDER BY id ASC
                LIMIT 10
                FOR UPDATE SKIP LOCKED
            `;

            // Mark immediately as PROCESSING within the SAME transaction.
            // This ensures the pessimistic lock is converted to a persistent state
            // before the transaction commits — defense in depth against edge cases
            // where SKIP LOCKED would not be sufficient alone.
            if (events.length > 0) {
                await tx.eventLog.updateMany({
                    where: { id: { in: events.map(e => e.id) }, dltTxId: null },
                    data: { dltTxId: 'PROCESSING' },
                });
            }

            return events;
        });

        if (pendingEvents.length === 0) {
            console.log('[AnchorQueue] No pending events to anchor.');
            return { processed: 0, items: [] };
        }

        const lockedEvents = pendingEvents;

        console.log(`[AnchorQueue] Locked ${lockedEvents.length} events for anchoring.`);

        // Resolve tenant chains for locked events (separate query avoids include type inference issues)
        const uniqueTenantIds = [...new Set(lockedEvents.map(e => e.tenantId))];
        const tenants = await prisma.tenant.findMany({
            where: { id: { in: uniqueTenantIds } },
            select: { id: true, targetChain: true },
        });
        const tenantChainMap = new Map(tenants.map(t => [t.id, t.targetChain]));

        // Group by chain to minimize adapter instantiations
        const byChain = new Map<string, typeof lockedEvents>();
        for (const event of lockedEvents) {
            const chain = tenantChainMap.get(event.tenantId) ?? 'ALGORAND';
            if (!byChain.has(chain)) byChain.set(chain, []);
            byChain.get(chain)!.push(event);
        }

        const results: Array<{ id: string; txId?: string; success: boolean; error?: string }> = [];

        for (const [chain, events] of byChain) {
            const adapter = DLTAdapterFactory.getAdapter(chain as SupportedChain);

            for (const event of events) {
                try {
                    const txId = await adapter.anchorEvent(event.id, event.signatureHash!);

                    await prisma.eventLog.update({
                        where: { id: event.id },
                        data: { dltTxId: txId },
                    });

                    console.log(`[AnchorQueue] Event ${event.id} anchored on ${chain}. TxID: ${txId}`);

                    await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_SUCCESS', {
                        eventId: event.id,
                        assetId: event.assetId,
                        dltTxId: txId,
                        status: 'APPROVED',
                        signatureHash: event.signatureHash,
                    });

                    results.push({ id: event.id, txId, success: true });
                } catch (error: any) {
                    console.error(`[AnchorQueue] Failed to anchor Event ${event.id}:`, error.stack || error);

                    if (error.message.includes('Insufficient funds') || error.message.includes('PENDING_FUNDS')) {
                        await prisma.eventLog.updateMany({
                            where: { id: event.id, dltTxId: 'PROCESSING' },
                            data: { dltTxId: null, status: 'PENDING_FUNDS' },
                        });
                    } else {
                        // Insert into PendingTransaction for RetryWorker instead of marking as FAILED_TIMEOUT
                        await RetryWorker.enqueue({
                            tenantId: event.tenantId,
                            txRef: event.id,
                            txType: 'ANCHOR',
                            chain,
                            payload: {
                                eventId: event.id,
                                hash: event.signatureHash,
                            },
                            error: error.message,
                        });

                        // Mark eventLog as failed but leave dltTxId as marker
                        await prisma.eventLog.updateMany({
                            where: { id: event.id, dltTxId: 'PROCESSING' },
                            data: { dltTxId: 'RETRY_QUEUED' },
                        });

                        await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_RETRY_QUEUED', {
                            eventId: event.id,
                            assetId: event.assetId,
                            status: 'RETRY_QUEUED',
                            errorReason: error.message,
                        });
                    }

                    results.push({ id: event.id, success: false, error: error.message });
                }
            }
        }

        return { processed: lockedEvents.length, items: results };
    }
}
