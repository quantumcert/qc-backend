// src/services/AnchorQueueService.ts
import prisma from '../config/prisma';
import { DLTAdapterFactory, SupportedChain } from './DLTAdapterFactory';
import { WebhookDispatcher } from '../utils/WebhookDispatcher';

export class AnchorQueueService {
    /**
     * Processes the queue of APPROVED events that do not yet have a DLT TxID.
     * Groups events by tenant chain to minimize adapter instantiations per batch.
     */
    static async processQueue() {
        const pendingEvents = await prisma.eventLog.findMany({
            where: {
                status: { in: ['APPROVED', 'PENDING_FUNDS'] },
                dltTxId: null,
                signatureHash: { not: null },
            },
            include: {
                tenant: { select: { targetChain: true } },
            },
            orderBy: { id: 'asc' }, // FIFO
            take: 10,
        });

        if (pendingEvents.length === 0) {
            console.log('[AnchorQueue] No pending events to anchor.');
            return { processed: 0, items: [] };
        }

        // Atomic row lock — prevents double-spend across workers
        const lockedEvents: typeof pendingEvents = [];
        for (const event of pendingEvents) {
            const lockResult = await prisma.eventLog.updateMany({
                where: { id: event.id, dltTxId: null },
                data: { dltTxId: 'PROCESSING' },
            });
            if (lockResult.count > 0) lockedEvents.push(event);
        }

        if (lockedEvents.length === 0) {
            console.log('[AnchorQueue] All candidate events were locked by another worker.');
            return { processed: 0, items: [] };
        }

        console.log(`[AnchorQueue] Locked ${lockedEvents.length} events for anchoring.`);

        // Group by chain to minimize adapter instantiations
        const byChain = new Map<string, typeof lockedEvents>();
        for (const event of lockedEvents) {
            const chain = (event.tenant?.targetChain as string) ?? 'ALGORAND';
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
                            data: { dltTxId: null, status: 'PENDING_FUNDS' as any },
                        });
                    } else {
                        await prisma.eventLog.updateMany({
                            where: { id: event.id, dltTxId: 'PROCESSING' },
                            data: { dltTxId: 'FAILED_TIMEOUT' },
                        });

                        await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_FAILED', {
                            eventId: event.id,
                            assetId: event.assetId,
                            status: 'DLQ',
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
