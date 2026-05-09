// ═══════════════════════════════════════════════════════════
// CURATION FACET — CORE-05 + CORE-06
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Handles public contribution submissions and authenticated review.
// Non-auditors go to PENDING_APPROVAL queue; auditors bypass directly.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// Only universal terms: Tenant, Asset, Event, Owner, Metadata.
// ═══════════════════════════════════════════════════════════

import prisma from '../../config/prisma';
import { AnchorQueueService } from '../AnchorQueueService';
import crypto from 'crypto';

const MAX_CONTRIBUTION_PAYLOAD_BYTES = 10 * 1024;
const MAX_CONTRIBUTION_PAYLOAD_DEPTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

function makeError(message: string, code: string, httpStatus: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.httpStatus = httpStatus;
    return err;
}

function getJsonDepth(value: unknown, currentDepth = 0): number {
    if (value === null || typeof value !== 'object') return currentDepth;
    let maxDepth = currentDepth + 1;
    if (Array.isArray(value)) {
        for (const item of value) {
            maxDepth = Math.max(maxDepth, getJsonDepth(item, currentDepth + 1));
        }
        return maxDepth;
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
        maxDepth = Math.max(maxDepth, getJsonDepth(item, currentDepth + 1));
    }
    return maxDepth;
}

function validateSubmissionInput(phone: string | undefined, email: string | undefined, payload: Record<string, any>): string {
    const normalizedPhone = phone?.trim();
    const normalizedEmail = email?.trim().toLowerCase();

    if (!normalizedPhone && !normalizedEmail) {
        throw makeError('phone or email required', 'INVALID_PAYLOAD', 400);
    }
    if (normalizedPhone && !PHONE_PATTERN.test(normalizedPhone)) {
        throw makeError('invalid phone format', 'INVALID_PAYLOAD', 400);
    }
    if (normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
        throw makeError('invalid email format', 'INVALID_PAYLOAD', 400);
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (payloadBytes > MAX_CONTRIBUTION_PAYLOAD_BYTES) {
        throw makeError('payload too large', 'PAYLOAD_TOO_LARGE', 413);
    }
    if (getJsonDepth(payload) > MAX_CONTRIBUTION_PAYLOAD_DEPTH) {
        throw makeError('payload too deeply nested', 'INVALID_PAYLOAD', 400);
    }

    return normalizedPhone ?? normalizedEmail!;
}

export class CurationFacet {
    /**
     * Public submission — phone or email required, no API key.
     * If the submitter is a registered auditor (Contributor.isAuditor=true),
     * creates an APPROVED EventLog directly and triggers AnchorQueue.
     * Otherwise, creates a PendingContribution with PENDING_APPROVAL status.
     */
    static async submitContribution(params: {
        assetId: string;
        phone?: string;
        email?: string;
        payload: Record<string, any>;
    }): Promise<{ queued: boolean; eventId?: string; pendingId?: string }> {
        const { assetId, phone, email, payload } = params;
        const ownerRef = validateSubmissionInput(phone, email, payload);

        const asset = await prisma.asset.findUnique({ where: { id: assetId } });
        if (!asset) {
            throw makeError('Asset not found', 'ASSET_NOT_FOUND', 404);
        }

        const contributor = await prisma.contributor.findUnique({
            where: { tenantId_ownerRef: { tenantId: asset.tenantId, ownerRef } },
        });
        const isAuditor = contributor?.isAuditor === true;

        if (isAuditor) {
            const signatureHash = crypto
                .createHash('sha3-512')
                .update(JSON.stringify(payload))
                .digest('hex');

            const event = await prisma.eventLog.create({
                data: {
                    assetId,
                    tenantId: asset.tenantId,
                    origin: `CURATION:${ownerRef}`,
                    status: 'APPROVED',
                    payload,
                    signatureHash,
                },
            });

            // TODO(OPS-03): substituir console.error por logger estruturado (Phase 4)
            AnchorQueueService.processQueue().catch(console.error);

            return { queued: true, eventId: event.id };
        }

        const pending = await prisma.pendingContribution.create({
            data: {
                tenantId: asset.tenantId,
                ownerId: ownerRef,
                assetId,
                payload,
                status: 'PENDING_APPROVAL',
            },
        });

        return { queued: false, pendingId: pending.id };
    }

    /**
     * Authenticated review — OPERATOR or ADMIN only.
     * Reviewer can only process contributions belonging to their tenantId (tenant isolation).
     * APPROVED: creates EventLog + triggers AnchorQueue fire-and-forget.
     * REJECTED: updates status + stores reviewedBy + reviewedAt.
     */
    static async reviewContribution(
        secureContext: { tenantId: string; role: string; apiKeyId: string },
        payload: { pendingId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }
    ): Promise<{ pendingId: string; status: 'APPROVED' | 'REJECTED'; eventId?: string }> {
        const { tenantId, role, apiKeyId } = secureContext;
        const { pendingId, decision, reason } = payload;

        if (role !== 'ADMIN' && role !== 'OPERATOR') {
            throw makeError('Forbidden', 'INSUFFICIENT_PERMISSIONS', 403);
        }
        if (decision !== 'APPROVED' && decision !== 'REJECTED') {
            throw makeError('Invalid decision', 'INVALID_PAYLOAD', 400);
        }

        // Tenant-scoped lookup — cross-tenant returns null → CONTRIBUTION_NOT_FOUND
        const pending = await prisma.pendingContribution.findFirst({
            where: { id: pendingId, tenantId },
        });

        if (!pending) {
            throw makeError('Contribution not found', 'CONTRIBUTION_NOT_FOUND', 404);
        }

        if (pending.status !== 'PENDING_APPROVAL') {
            throw makeError('Contribution already reviewed', 'ALREADY_REVIEWED', 409);
        }

        if (decision === 'APPROVED') {
            const result = await prisma.$transaction(async (tx) => {
                await tx.pendingContribution.update({
                    where: { id: pendingId },
                    data: {
                        status: 'APPROVED',
                        reviewedBy: apiKeyId,
                        reviewedAt: new Date(),
                    },
                });

                const signatureHash = crypto
                    .createHash('sha3-512')
                    .update(JSON.stringify(pending.payload))
                    .digest('hex');

                const event = await tx.eventLog.create({
                    data: {
                        assetId: pending.assetId!,
                        tenantId,
                        origin: `CURATION_REVIEW:${apiKeyId}`,
                        status: 'APPROVED',
                        payload: pending.payload as any,
                        signatureHash,
                    },
                });

                return { eventId: event.id };
            });

            // TODO(OPS-03): substituir console.error por logger estruturado (Phase 4)
            AnchorQueueService.processQueue().catch(console.error);

            return { pendingId, status: 'APPROVED', eventId: result.eventId };
        } else {
            await prisma.pendingContribution.update({
                where: { id: pendingId },
                data: {
                    status: 'REJECTED',
                    reviewedBy: apiKeyId,
                    reviewedAt: new Date(),
                    payload: {
                        ...(pending.payload as Record<string, any>),
                        _rejectionReason: reason ?? null,
                    },
                },
            });

            return { pendingId, status: 'REJECTED' };
        }
    }
}
