import { Response } from 'express';
import { z } from 'zod';
import {
    Prisma,
    QTagFulfillmentStatus,
    QTagLedgerEntryType,
} from '@prisma/client';
import {
    QTagFulfillmentError,
    QTagFulfillmentFacet,
} from '../services/core-facets/QTagFulfillmentFacet';
import { AdminAuthorizationError } from '../services/core-facets/AdminAuthorizationFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

const listSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const qtagLedgerListSchema = listSchema.extend({
    userId: z.string().trim().min(1).optional(),
    entryType: z.nativeEnum(QTagLedgerEntryType).optional(),
});

const qtagGrantSchema = z.object({
    quantity: z.number().int().positive(),
    userId: z.string().trim().min(1).nullable().optional(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    referenceType: z.string().trim().min(1).optional(),
    referenceId: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
});

const qtagReserveSchema = z.object({
    assetId: z.string().trim().min(1),
    userId: z.string().trim().min(1).nullable().optional(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    shippingRecipient: z.record(z.unknown()).optional(),
    sku: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
});

const qtagReleaseSchema = z.object({
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
});

const qtagStatusSchema = z.object({
    status: z.nativeEnum(QTagFulfillmentStatus),
    reason: z.string().trim().min(1),
    trackingCode: z.string().trim().min(1).optional(),
    carrier: z.string().trim().min(1).optional(),
    notes: z.string().trim().min(1).optional(),
    claimedByActorId: z.string().trim().min(1).optional(),
    lastError: z.string().trim().min(1).optional(),
});

const qtagQueueSchema = listSchema.extend({
    tenantId: z.string().trim().min(1).optional(),
    status: z.nativeEnum(QTagFulfillmentStatus).optional(),
});

export class AdminQTagController {
    static async getSummary(req: AuthenticatedRequest, res: Response) {
        try {
            const query = z.object({
                userId: z.string().trim().min(1).optional(),
            }).parse(req.query);
            const result = await QTagFulfillmentFacet.getQTagBalance(
                req.adminActor!,
                req.params.tenantId,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.getSummary]');
        }
    }

    static async listLedger(req: AuthenticatedRequest, res: Response) {
        try {
            const query = qtagLedgerListSchema.parse(req.query);
            const result = await QTagFulfillmentFacet.listLedgerEntries(
                req.adminActor!,
                req.params.tenantId,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.listLedger]');
        }
    }

    static async grant(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = qtagGrantSchema.parse(req.body);
            const result = await QTagFulfillmentFacet.grantQTags(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    metadata: payload.metadata as Prisma.InputJsonValue | undefined,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.grant]');
        }
    }

    static async reserve(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = qtagReserveSchema.parse(req.body);
            const result = await QTagFulfillmentFacet.reserveForAsset(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    shippingRecipient: payload.shippingRecipient as Prisma.InputJsonValue | undefined,
                    metadata: payload.metadata as Prisma.InputJsonValue | undefined,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.reserve]');
        }
    }

    static async release(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = qtagReleaseSchema.parse(req.body);
            const result = await QTagFulfillmentFacet.releaseReservation(
                req.adminActor!,
                req.params.tenantId,
                req.params.orderId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.release]');
        }
    }

    static async transitionStatus(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = qtagStatusSchema.parse(req.body);
            const result = await QTagFulfillmentFacet.transitionFulfillmentStatus(
                req.adminActor!,
                req.params.tenantId,
                req.params.orderId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.transitionStatus]');
        }
    }

    static async listQueue(req: AuthenticatedRequest, res: Response) {
        try {
            const query = qtagQueueSchema.parse(req.query);
            const result = await QTagFulfillmentFacet.listFulfillmentQueue(
                req.adminActor!,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithQTagError(error, res, '[AdminQTagController.listQueue]');
        }
    }
}

function buildMeta() {
    return {
        timestamp: new Date().toISOString(),
        facet: DiamondFacets.QTAG_FULFILLMENT,
    };
}

function respondWithQTagError(error: unknown, res: Response, logPrefix: string) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: error.errors,
        });
    }

    if (error instanceof QTagFulfillmentError || error instanceof AdminAuthorizationError) {
        const statusMap: Record<string, number> = {
            ADMIN_ACTOR_REQUIRED: 401,
            ADMIN_REASON_REQUIRED: 400,
            PLATFORM_ADMIN_REQUIRED: 403,
            TENANT_NOT_FOUND: 404,
            ASSET_NOT_FOUND: 404,
            FULFILLMENT_ORDER_NOT_FOUND: 404,
            INVALID_QUANTITY: 400,
            IDEMPOTENCY_KEY_REQUIRED: 400,
            INSUFFICIENT_QTAGS: 409,
            INSUFFICIENT_RESERVED_QTAGS: 409,
            QTAG_ALREADY_RESERVED: 409,
            QTAG_ALREADY_ACTIVATED: 409,
            ASSET_ALREADY_TAGGED: 409,
        };

        return res.status(statusMap[error.code] || 400).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }

    console.error(logPrefix, error);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
}
