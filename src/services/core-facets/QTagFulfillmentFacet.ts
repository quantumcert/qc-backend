import prisma from '../../config/prisma';
import {
    Prisma,
    QTagFulfillmentOrder,
    QTagFulfillmentStatus,
    QTagLedgerEntry,
    QTagLedgerEntryType,
    TenantMembershipRole,
} from '@prisma/client';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';
import { AdminAuthorizationFacet } from './AdminAuthorizationFacet';

type QTagScope = {
    userId?: string | null;
};

type QTagMutationContext = QTagScope & {
    quantity: number;
    reason?: string;
    idempotencyKey?: string;
    referenceType?: string;
    referenceId?: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
};

type ReserveForAssetParams = QTagScope & {
    assetId: string;
    reason?: string;
    idempotencyKey?: string;
    shippingRecipient?: Prisma.InputJsonValue;
    sku?: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
};

type ReleaseReservationParams = {
    reason?: string;
    idempotencyKey?: string;
    ipAddress?: string;
    userAgent?: string;
};

type ConsumeReservationParams = {
    tenantId: string;
    fulfillmentOrderId: string;
    assetId: string;
    userId?: string | null;
    reason?: string;
};

type ListQueueParams = {
    page?: number;
    limit?: number;
    tenantId?: string;
    status?: QTagFulfillmentStatus;
};

type TransitionFulfillmentParams = {
    status: QTagFulfillmentStatus;
    reason?: string;
    trackingCode?: string;
    carrier?: string;
    notes?: string;
    claimedByActorId?: string;
    lastError?: string;
    ipAddress?: string;
    userAgent?: string;
};

const QTAG_ACTIONS = {
    QTAG_GRANTED: 'QTAG_GRANTED',
    QTAG_RESERVED: 'QTAG_RESERVED',
    QTAG_RELEASED: 'QTAG_RELEASED',
    QTAG_STATUS_CHANGED: 'QTAG_STATUS_CHANGED',
} as const;

export class QTagFulfillmentFacet {
    static async getQTagBalance(
        actor: AdminActorContext,
        tenantId: string,
        params: QTagScope = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);
        return this.getBalanceProjection(prisma, tenantId, params.userId);
    }

    static async listLedgerEntries(
        actor: AdminActorContext,
        tenantId: string,
        params: QTagScope & { page?: number; limit?: number; entryType?: QTagLedgerEntryType } = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where: Prisma.QTagLedgerEntryWhereInput = {
            tenantId,
            ...(params.userId ? { userId: params.userId } : {}),
            ...(params.entryType ? { entryType: params.entryType } : {}),
        };

        const [entries, total] = await Promise.all([
            prisma.qTagLedgerEntry.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
            prisma.qTagLedgerEntry.count({ where }),
        ]);

        return {
            entries,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    static async grantQTags(
        actor: AdminActorContext,
        tenantId: string,
        params: QTagMutationContext
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        const quantity = normalizePositiveQuantity(params.quantity);
        await this.ensureTenantExists(tenantId);

        return prisma.$transaction(async (tx) => {
            if (params.idempotencyKey) {
                const existing = await this.findIdempotentEntry(tx, tenantId, params.idempotencyKey);
                if (existing) return existing;
            }

            const entry = await this.createLedgerEntry(tx, {
                tenantId,
                userId: params.userId,
                entryType: QTagLedgerEntryType.GRANTED,
                quantity,
                availableDelta: quantity,
                reservedDelta: 0,
                idempotencyKey: params.idempotencyKey,
                referenceType: params.referenceType,
                referenceId: params.referenceId,
                actorUserId: actor.actorUserId,
                reason,
                metadata: params.metadata,
            });

            await this.createAdminAuditLog(tx, {
                actor,
                tenantId,
                action: QTAG_ACTIONS.QTAG_GRANTED,
                resourceId: entry.id,
                reason,
                metadata: {
                    quantity,
                    entryType: QTagLedgerEntryType.GRANTED,
                    facet: DiamondFacets.QTAG_FULFILLMENT,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return entry;
        });
    }

    static async purchaseConfirmed(
        tx: any,
        params: {
            tenantId: string;
            userId?: string | null;
            purchaseOrderId: string;
            quantity: number;
            idempotencyKey: string;
            reason?: string;
            metadata?: Prisma.InputJsonValue;
        }
    ) {
        const quantity = normalizePositiveQuantity(params.quantity);
        validateIdempotencyKey(params.idempotencyKey);

        const existing = await this.findIdempotentEntry(tx, params.tenantId, params.idempotencyKey);
        if (existing) return existing;

        return this.createLedgerEntry(tx, {
            tenantId: params.tenantId,
            userId: params.userId,
            purchaseOrderId: params.purchaseOrderId,
            entryType: QTagLedgerEntryType.PURCHASED,
            quantity,
            availableDelta: quantity,
            reservedDelta: 0,
            idempotencyKey: params.idempotencyKey,
            referenceType: 'purchase_order',
            referenceId: params.purchaseOrderId,
            reason: params.reason || 'Compra de QTAG confirmada pelo provedor.',
            metadata: params.metadata,
        });
    }

    static async reserveForAsset(
        actor: AdminActorContext,
        tenantId: string,
        params: ReserveForAssetParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        await this.ensureTenantExists(tenantId);

        const asset = await prisma.asset.findFirst({
            where: { id: params.assetId, tenantId },
            select: { id: true, tenantId: true, deviceId: true },
        });

        if (!asset) {
            throw new QTagFulfillmentError('ASSET_NOT_FOUND', 'Asset not found for this tenant.');
        }
        if (asset.deviceId) {
            throw new QTagFulfillmentError('ASSET_ALREADY_TAGGED', 'Asset already has an active device linked.');
        }

        const idempotencyKey = params.idempotencyKey || `qtag-reserve:${tenantId}:${params.assetId}`;

        return prisma.$transaction(async (tx) => {
            const existingLedger = await this.findIdempotentEntry(tx, tenantId, idempotencyKey);
            if (existingLedger) {
                const existingOrder = await tx.qTagFulfillmentOrder.findFirst({
                    where: { tenantId, assetId: params.assetId },
                    orderBy: { createdAt: 'desc' },
                });
                return { order: existingOrder, ledgerEntry: existingLedger, deduped: true };
            }

            const activeOrder = await tx.qTagFulfillmentOrder.findFirst({
                where: {
                    tenantId,
                    assetId: params.assetId,
                    status: { notIn: [QTagFulfillmentStatus.CANCELLED, QTagFulfillmentStatus.EXPIRED] },
                },
            });

            if (activeOrder) {
                throw new QTagFulfillmentError('QTAG_ALREADY_RESERVED', 'Asset already has an active QTAG fulfillment order.');
            }

            const balance = await this.getBalanceProjection(tx, tenantId, params.userId);
            if (balance.available < 1) {
                throw new QTagFulfillmentError('INSUFFICIENT_QTAGS', 'There are not enough available QTAGs to reserve.');
            }

            const order = await tx.qTagFulfillmentOrder.create({
                data: {
                    tenantId,
                    userId: params.userId || undefined,
                    assetId: params.assetId,
                    status: QTagFulfillmentStatus.REQUESTED,
                    sku: params.sku,
                    shippingRecipient: params.shippingRecipient,
                    claimedByActorId: actor.actorUserId,
                    notes: reason,
                },
            });

            const ledgerEntry = await this.createLedgerEntry(tx, {
                tenantId,
                userId: params.userId,
                fulfillmentOrderId: order.id,
                entryType: QTagLedgerEntryType.RESERVED,
                quantity: 1,
                availableDelta: -1,
                reservedDelta: 1,
                idempotencyKey,
                referenceType: 'asset',
                referenceId: params.assetId,
                actorUserId: actor.actorUserId,
                reason,
                metadata: params.metadata,
            });

            await this.createAdminAuditLog(tx, {
                actor,
                tenantId,
                action: QTAG_ACTIONS.QTAG_RESERVED,
                resourceId: order.id,
                reason,
                metadata: {
                    assetId: params.assetId,
                    ledgerEntryId: ledgerEntry.id,
                    facet: DiamondFacets.QTAG_FULFILLMENT,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return { order, ledgerEntry, deduped: false };
        });
    }

    static async releaseReservation(
        actor: AdminActorContext,
        tenantId: string,
        fulfillmentOrderId: string,
        params: ReleaseReservationParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        await this.ensureTenantExists(tenantId);
        const idempotencyKey = params.idempotencyKey || `qtag-release:${fulfillmentOrderId}`;

        return prisma.$transaction(async (tx) => {
            const order = await tx.qTagFulfillmentOrder.findFirst({
                where: { id: fulfillmentOrderId, tenantId },
            });

            if (!order) {
                throw new QTagFulfillmentError('FULFILLMENT_ORDER_NOT_FOUND', 'QTAG fulfillment order not found.');
            }
            if (order.status === QTagFulfillmentStatus.ACTIVATED) {
                throw new QTagFulfillmentError('QTAG_ALREADY_ACTIVATED', 'Activated QTAGs cannot be released silently.');
            }

            const existing = await this.findIdempotentEntry(tx, tenantId, idempotencyKey);
            if (existing) return { order, ledgerEntry: existing, deduped: true };

            const balance = await this.getBalanceProjection(tx, tenantId, order.userId);
            if (balance.reserved < 1) {
                throw new QTagFulfillmentError('INSUFFICIENT_RESERVED_QTAGS', 'There are not enough reserved QTAGs to release.');
            }

            const ledgerEntry = await this.createLedgerEntry(tx, {
                tenantId,
                userId: order.userId,
                fulfillmentOrderId: order.id,
                entryType: QTagLedgerEntryType.RELEASED,
                quantity: 1,
                availableDelta: 1,
                reservedDelta: -1,
                idempotencyKey,
                referenceType: 'qtag_fulfillment_order',
                referenceId: order.id,
                actorUserId: actor.actorUserId,
                reason,
            });

            const updatedOrder = await tx.qTagFulfillmentOrder.update({
                where: { id: fulfillmentOrderId },
                data: {
                    status: QTagFulfillmentStatus.CANCELLED,
                    cancelledAt: new Date(),
                    cancellationReason: reason,
                    lastError: null,
                },
            });

            await this.createAdminAuditLog(tx, {
                actor,
                tenantId,
                action: QTAG_ACTIONS.QTAG_RELEASED,
                resourceId: fulfillmentOrderId,
                reason,
                metadata: {
                    ledgerEntryId: ledgerEntry.id,
                    assetId: order.assetId,
                    facet: DiamondFacets.QTAG_FULFILLMENT,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return { order: updatedOrder, ledgerEntry, deduped: false };
        });
    }

    static async consumeReservation(tx: any, params: ConsumeReservationParams) {
        const idempotencyKey = `qtag-consume:${params.fulfillmentOrderId}`;
        const existing = await this.findIdempotentEntry(tx, params.tenantId, idempotencyKey);
        if (existing) return existing;

        const balance = await this.getBalanceProjection(tx, params.tenantId, params.userId);
        if (balance.reserved < 1) {
            throw new QTagFulfillmentError('INSUFFICIENT_RESERVED_QTAGS', 'There are not enough reserved QTAGs to consume.');
        }

        return this.createLedgerEntry(tx, {
            tenantId: params.tenantId,
            userId: params.userId,
            fulfillmentOrderId: params.fulfillmentOrderId,
            entryType: QTagLedgerEntryType.CONSUMED,
            quantity: 1,
            availableDelta: 0,
            reservedDelta: -1,
            idempotencyKey,
            referenceType: 'qtag_fulfillment_order',
            referenceId: params.fulfillmentOrderId,
            reason: params.reason || 'QTAG ativada após gravação física confirmada.',
            metadata: { assetId: params.assetId },
        });
    }

    static async listFulfillmentQueue(
        actor: AdminActorContext,
        params: ListQueueParams = {}
    ) {
        this.ensurePlatformActor(actor);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where: Prisma.QTagFulfillmentOrderWhereInput = {
            ...(params.tenantId ? { tenantId: params.tenantId } : {}),
            ...(params.status ? { status: params.status } : {}),
        };

        const [orders, total] = await Promise.all([
            prisma.qTagFulfillmentOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { updatedAt: 'desc' },
                include: {
                    tenant: { select: { id: true, name: true, slug: true } },
                    asset: { select: { id: true, externalId: true, status: true, deviceId: true } },
                    encodingSessions: { orderBy: { createdAt: 'desc' }, take: 1 },
                },
            }),
            prisma.qTagFulfillmentOrder.count({ where }),
        ]);

        return {
            orders,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    static async transitionFulfillmentStatus(
        actor: AdminActorContext,
        tenantId: string,
        fulfillmentOrderId: string,
        params: TransitionFulfillmentParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        await this.ensureTenantExists(tenantId);

        const order = await prisma.$transaction(async (tx) => {
            const existing = await tx.qTagFulfillmentOrder.findFirst({
                where: { id: fulfillmentOrderId, tenantId },
            });

            if (!existing) {
                throw new QTagFulfillmentError('FULFILLMENT_ORDER_NOT_FOUND', 'QTAG fulfillment order not found.');
            }
            if (existing.status === QTagFulfillmentStatus.ACTIVATED && params.status !== QTagFulfillmentStatus.ACTIVATED) {
                throw new QTagFulfillmentError('QTAG_ALREADY_ACTIVATED', 'Activated QTAG status cannot be moved by this operation.');
            }

            const updated = await tx.qTagFulfillmentOrder.update({
                where: { id: fulfillmentOrderId },
                data: {
                    status: params.status,
                    trackingCode: params.trackingCode,
                    carrier: params.carrier,
                    notes: params.notes,
                    claimedByActorId: params.claimedByActorId || actor.actorUserId,
                    lastError: params.lastError,
                    ...(params.status === QTagFulfillmentStatus.DISPATCHED ? { dispatchedAt: new Date() } : {}),
                    ...(params.status === QTagFulfillmentStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
                },
            });

            await this.createAdminAuditLog(tx, {
                actor,
                tenantId,
                action: QTAG_ACTIONS.QTAG_STATUS_CHANGED,
                resourceId: fulfillmentOrderId,
                reason,
                metadata: {
                    fromStatus: existing.status,
                    toStatus: params.status,
                    assetId: existing.assetId,
                    facet: DiamondFacets.QTAG_FULFILLMENT,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return updated;
        });

        return order;
    }

    private static async createLedgerEntry(
        tx: any,
        params: {
            tenantId: string;
            userId?: string | null;
            purchaseOrderId?: string;
            fulfillmentOrderId?: string;
            entryType: QTagLedgerEntryType;
            quantity: number;
            availableDelta: number;
            reservedDelta: number;
            idempotencyKey?: string;
            referenceType?: string;
            referenceId?: string;
            actorUserId?: string;
            reason?: string;
            metadata?: Prisma.InputJsonValue;
        }
    ) {
        return tx.qTagLedgerEntry.create({
            data: {
                tenantId: params.tenantId,
                userId: params.userId || undefined,
                purchaseOrderId: params.purchaseOrderId,
                fulfillmentOrderId: params.fulfillmentOrderId,
                entryType: params.entryType,
                quantity: params.quantity,
                availableDelta: params.availableDelta,
                reservedDelta: params.reservedDelta,
                idempotencyKey: params.idempotencyKey,
                referenceType: params.referenceType,
                referenceId: params.referenceId,
                actorUserId: params.actorUserId,
                reason: params.reason,
                metadata: params.metadata ?? {},
            },
        });
    }

    private static async findIdempotentEntry(
        tx: any,
        tenantId: string,
        idempotencyKey?: string
    ): Promise<QTagLedgerEntry | null> {
        if (!idempotencyKey) return null;
        return tx.qTagLedgerEntry.findUnique({
            where: {
                tenantId_idempotencyKey: {
                    tenantId,
                    idempotencyKey,
                },
            },
        });
    }

    private static async getBalanceProjection(tx: any, tenantId: string, userId?: string | null) {
        const entries = await tx.qTagLedgerEntry.findMany({
            where: {
                tenantId,
                ...(userId ? { userId } : {}),
            },
            select: {
                entryType: true,
                quantity: true,
                availableDelta: true,
                reservedDelta: true,
            },
        });

        const totals = entries.reduce((acc: {
            available: number;
            reserved: number;
            byType: Record<string, number>;
        }, entry: any) => {
            acc.available += entry.availableDelta;
            acc.reserved += entry.reservedDelta;
            acc.byType[entry.entryType] = (acc.byType[entry.entryType] || 0) + entry.quantity;
            return acc;
        }, { available: 0, reserved: 0, byType: {} as Record<string, number> });

        return {
            tenantId,
            userId: userId ?? null,
            available: totals.available,
            reserved: totals.reserved,
            total: totals.available + totals.reserved,
            purchased: totals.byType[QTagLedgerEntryType.PURCHASED] || 0,
            granted: totals.byType[QTagLedgerEntryType.GRANTED] || 0,
            consumed: totals.byType[QTagLedgerEntryType.CONSUMED] || 0,
            released: totals.byType[QTagLedgerEntryType.RELEASED] || 0,
            revoked: totals.byType[QTagLedgerEntryType.REVOKED] || 0,
            entryCount: entries.length,
        };
    }

    private static async createAdminAuditLog(
        tx: any,
        params: {
            tenantId: string;
            actor: AdminActorContext;
            action: string;
            resourceId: string;
            reason: string;
            metadata: Prisma.InputJsonValue;
            ipAddress?: string;
            userAgent?: string;
        }
    ) {
        await tx.adminAuditLog.create({
            data: {
                tenantId: params.tenantId,
                actorUserId: params.actor.actorUserId,
                actorTenantId: params.actor.actorTenantId,
                action: params.action,
                resourceType: ResourceTypes.QTAG_FULFILLMENT_ORDER,
                resourceId: params.resourceId,
                reason: params.reason,
                correlationId: params.actor.correlationId,
                metadata: params.metadata,
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            },
        });
    }

    private static ensurePlatformActor(actor?: AdminActorContext) {
        if (!actor?.actorUserId) {
            throw new QTagFulfillmentError('ADMIN_ACTOR_REQUIRED', 'Platform admin actor is required.');
        }

        if (actor.role !== TenantMembershipRole.PLATFORM_ADMIN) {
            throw new QTagFulfillmentError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }
    }

    private static async ensureTenantExists(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });

        if (!tenant) {
            throw new QTagFulfillmentError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }
    }
}

function normalizePositiveQuantity(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new QTagFulfillmentError('INVALID_QUANTITY', 'QTAG quantity must be a positive integer.');
    }
    return value;
}

function validateIdempotencyKey(value?: string) {
    if (!value?.trim()) {
        throw new QTagFulfillmentError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key is required for QTAG ledger operations.');
    }
}

function normalizePage(value?: number): number {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizeLimit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(Math.floor(value), 100);
}

export class QTagFulfillmentError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'QTagFulfillmentError';
    }
}
