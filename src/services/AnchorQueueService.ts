import prisma from '../config/prisma';
import { IDLTAdapter } from '../interfaces/IDLTAdapter';
import { WebhookDispatcher } from '../utils/WebhookDispatcher';

export class AnchorQueueService {
    private adapter: IDLTAdapter;

    constructor(adapter: IDLTAdapter) {
        this.adapter = adapter;
    }

    /**
     * Processes the queue of APPROVED events that do not yet have a DLT TxID.
     */
    async processQueue() {
        const pendingEvents = await prisma.eventLog.findMany({
            where: {
                status: { in: ['APPROVED', 'PENDING_FUNDS'] }, // Pick up failures due to funds
                dltTxId: null,
                signatureHash: { not: null }
            },
            orderBy: { id: 'asc' }, // RED TEAM HOTFIX 7: Strict FIFO Queue
            take: 10 // process in batches
        });

        if (pendingEvents.length === 0) {
            console.log('[AnchorQueue] No pending events to anchor.');
            return { processed: 0, items: [] };
        }

        // RED TEAM HOTFIX 2 (Race Condition): Atomic row locking to prevent double gas spend
        const lockedEvents = [];
        for (const event of pendingEvents) {
            const lockResult = await prisma.eventLog.updateMany({
                where: { id: event.id, dltTxId: null }, // Atomic check: only lock if still null
                data: { dltTxId: 'PROCESSING' }
            });
            if (lockResult.count > 0) {
                lockedEvents.push(event);
            }
        }

        if (lockedEvents.length === 0) {
            console.log('[AnchorQueue] All candidate events were locked by another worker.');
            return { processed: 0, items: [] };
        }

        console.log(`[AnchorQueue] Secured lock on ${lockedEvents.length} events to anchor.`);

        const results = [];

        for (const event of lockedEvents) {
            try {
                // Call the DLT Adapter
                const txId = await this.adapter.anchorEvent(event.id, event.signatureHash!);

                // Update the EventLog with the final TxID
                await prisma.eventLog.update({
                    where: { id: event.id },
                    data: { dltTxId: txId }
                });

                console.log(`[AnchorQueue] Event ${event.id} anchored successfully. TxID: ${txId}`);

                // LAYER 3: Active Webhooks (ANCHOR_SUCCESS)
                await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_SUCCESS', {
                    eventId: event.id,
                    assetId: event.assetId,
                    dltTxId: txId,
                    status: 'APPROVED',
                    signatureHash: event.signatureHash
                });

                results.push({ id: event.id, txId, success: true });
            } catch (error: any) {
                console.error(`[AnchorQueue] Failed to anchor Event ${event.id}:`, error.stack || error);

                // RED TEAM HOTFIX 4 (Gas Drain): Mark as FAILED instead of null to prevent infinite loop
                let newTxIdState = 'FAILED_TIMEOUT';
                let isDlq = false;

                if (error.message.includes('Insufficient funds') || error.message.includes('PENDING_FUNDS')) {
                    newTxIdState = null as any; // Allow retry, strictly keeping FIFO
                    await prisma.eventLog.updateMany({
                        where: { id: event.id, dltTxId: 'PROCESSING' },
                        data: { dltTxId: newTxIdState, status: 'PENDING_FUNDS' as any }
                    });
                } else {
                    isDlq = true;
                    // Fatal Error (DLQ)
                    await prisma.eventLog.updateMany({
                        where: { id: event.id, dltTxId: 'PROCESSING' },
                        data: { dltTxId: newTxIdState }
                    });
                }

                if (isDlq) {
                    // LAYER 3: Active Webhooks (ANCHOR_FAILED / DLQ)
                    await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_FAILED', {
                        eventId: event.id,
                        assetId: event.assetId,
                        dltTxId: newTxIdState,
                        status: 'DLQ',
                        errorReason: error.message
                    });
                }

                results.push({ id: event.id, success: false, error: error.message });
            }
        }

        return { processed: lockedEvents.length, items: results };
    }
}
