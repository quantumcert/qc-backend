import prisma from '../../config/prisma';
import { AuditActions, ResourceTypes } from '../../types';
import crypto from 'crypto';
import { WebhookDispatcher } from '../../utils/WebhookDispatcher';
import { AlgorandAnchorFacet } from './AlgorandAnchorFacet';
import { AnchorQueueService } from '../AnchorQueueService';

export class EventLogFacet {
    /**
     * Flow A: Event creation by Authenticated Request (API Key) -> APPROVED
     */
    static async recordAuthenticatedEvent(secureContext: any, requestPayload?: any) {
        // Handle dual calling signature (DiamondProxy vs Direct/Tests)
        let assetId: string, origin: string, payload: any;
        let tenantId = secureContext.tenantId;
        let role = secureContext.role || 'ADMIN';
        let apiKeyId = secureContext.apiKeyId || secureContext.origin;

        if (requestPayload && requestPayload.assetId) {
            assetId = requestPayload.assetId;
            origin = requestPayload.origin || 'API_KEY';
            payload = requestPayload.payload || requestPayload;
        } else {
            assetId = secureContext.assetId;
            origin = secureContext.origin;
            payload = secureContext.payload;
        }

        const asset = await prisma.asset.findUnique({
            where: { id: assetId }
        });

        if (!asset) {
            throw new Error("Asset not found");
        }

        // RBAC BYPASS (Fluxo Peritos/Auditores)
        if (asset.tenantId !== tenantId) {
            if (role !== 'EXPERT' && role !== 'AUDITOR') {
                throw new Error("Forbidden: You do not own this asset and lack EXPERT/AUDITOR privileges.");
            }
        }

        // Generate SHA3-512 Hash for Phase 6 DLT Anchor (Quantum Resistant)
        const signatureHash = crypto.createHash('sha3-512').update(JSON.stringify(payload)).digest('hex');

        const result = await prisma.$transaction(async (tx) => {
            const event = await tx.eventLog.create({
                data: {
                    assetId,
                    tenantId: asset.tenantId, // Always bind event to the asset's tenant
                    issuerId: apiKeyId || origin, // Dissociating the author
                    origin: role === 'EXPERT' || role === 'AUDITOR' ? `BYPASS_${role}` : origin,
                    status: 'APPROVED',
                    payload,
                    signatureHash
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    action: 'EVENT_CREATED',
                    resourceType: 'EVENT',
                    resourceId: event.id,
                    metadata: { assetId, origin, flow: 'AUTHENTICATED' }
                }
            });

            return event;
        });

        // Trigger the DLT Anchor Queue asynchronously (Fire and Forget)
        const dltAdapter = new AlgorandAnchorFacet();
        const queueService = new AnchorQueueService(dltAdapter);
        queueService.processQueue().catch(console.error);

        return result;
    }

    /**
     * Flow B: Event suggestion by Public Request -> PENDING
     */
    static async suggestPublicEvent(params: {
        assetId: string;
        payload: Record<string, any>;
    }) {
        const { assetId, payload } = params;

        // Fetch asset to determine tenantId
        const asset = await prisma.asset.findUnique({
            where: { id: assetId }
        });

        if (!asset) {
            throw new Error("Asset not found");
        }

        const event = await prisma.eventLog.create({
            data: {
                assetId,
                tenantId: asset.tenantId,
                origin: "PUBLIC",
                status: 'PENDING',
                payload
            }
        });

        // Trigger real Webhook/Notification sync
        EventLogFacet.triggerReviewNotification(asset.tenantId, event.id, asset.id);

        return event;
    }

    /**
     * Review Event (Owner/Authenticated): transition PENDING to APPROVED or REJECTED
     * RED TEAM HOTFIX: Modified signature to (secureContext, payload)
     */
    static async reviewEvent(secureContext: { tenantId: string }, payload: { eventId: string, status: 'APPROVED' | 'REJECTED' }) {
        const { eventId, status } = payload;
        const tenantId = secureContext.tenantId; // Injected by DiamondProxy securely

        // First, check basic existence (not required if we fully trust updateMany, but good for custom errors)
        const event = await prisma.eventLog.findUnique({
            where: { id: eventId }
        });

        if (!event) {
            throw new Error("Event not found");
        }

        // We compute hash prior to the atomic update
        let signatureHash = undefined;
        if (status === 'APPROVED') {
            signatureHash = crypto.createHash('sha3-512').update(JSON.stringify(event.payload)).digest('hex');
        }

        const result = await prisma.$transaction(async (tx) => {
            // RED TEAM HOTFIX 2 (Race Condition / Machine State bypass):
            // Atomic update that ONLY succeeds if the status is exactly PENDING and belongs to the right Tenant
            const updateResult = await tx.eventLog.updateMany({
                where: {
                    id: eventId,
                    tenantId: tenantId,    // IDOR Lock
                    status: 'PENDING'      // RACE CONDITION/STATE Lock! Fails if already approved this millisecond
                },
                data: {
                    status,
                    signatureHash
                }
            });

            if (updateResult.count === 0) {
                throw new Error("State Transition Error: Event not found, unauthorized, or already processed.");
            }

            // Fetch the updated event record since updateMany doesn't return the row
            const finalEvent = await tx.eventLog.findUnique({
                where: { id: eventId }
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    action: `EVENT_${status}`,
                    resourceType: 'EVENT',
                    resourceId: eventId,
                    metadata: { assetId: event!.assetId, priorStatus: 'PENDING' }
                }
            });

            return finalEvent;
        });

        if (status === 'APPROVED') {
            const dltAdapter = new AlgorandAnchorFacet();
            const queueService = new AnchorQueueService(dltAdapter);
            queueService.processQueue().catch(console.error);
        }

        return result;
    }

    private static triggerReviewNotification(tenantId: string, eventId: string, assetId: string) {
        WebhookDispatcher.dispatch(tenantId, 'EVENT_LOG_CREATED', {
            eventId,
            assetId,
            message: 'New Event is pending review'
        });
    }

    /**
     * Helper to truncate a SHA3-512 hash into a smaller 64-char hex string
     * for constrained NFC NDEF memory limitations.
     */
    static generateNfcTruncatedHash(sha3Hash: string): string {
        return sha3Hash.substring(0, 64);
    }
}
