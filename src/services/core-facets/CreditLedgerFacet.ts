import prisma from '../../config/prisma';
import {
    CreditLedgerEntry,
    CreditLedgerEntryType,
    Prisma,
    TenantMembershipRole,
} from '@prisma/client';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';
import { AdminAuthorizationFacet } from './AdminAuthorizationFacet';

type CreditLedgerScope = {
    userId?: string | null;
};

type CreditLedgerMutationContext = CreditLedgerScope & {
    amount: number;
    reason?: string;
    idempotencyKey?: string;
    referenceType?: string;
    referenceId?: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
};

type AdjustCreditsParams = CreditLedgerScope & {
    delta: number;
    reason?: string;
    idempotencyKey?: string;
    referenceType?: string;
    referenceId?: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
};

type OperationalCreditsParams = CreditLedgerScope & {
    tenantId: string;
    amount: number;
    idempotencyKey: string;
    referenceType?: string;
    referenceId?: string;
    reason?: string;
    metadata?: Prisma.InputJsonValue;
    purchaseOrderId?: string;
};

type ListLedgerParams = CreditLedgerScope & {
    page?: number;
    limit?: number;
    entryType?: CreditLedgerEntryType;
};

const CREDIT_LEDGER_ACTIONS = {
    CREDIT_GRANTED: 'CREDIT_GRANTED',
    CREDIT_ADJUSTED: 'CREDIT_ADJUSTED',
    CREDIT_REVOKED: 'CREDIT_REVOKED',
} as const;

export class CreditLedgerFacet {
    static async getBalance(
        actor: AdminActorContext,
        tenantId: string,
        params: CreditLedgerScope = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);
        return this.getBalanceProjection(prisma, tenantId, params.userId);
    }

    static async listEntries(
        actor: AdminActorContext,
        tenantId: string,
        params: ListLedgerParams = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where = buildLedgerWhere(tenantId, params);

        const [entries, total] = await Promise.all([
            prisma.creditLedgerEntry.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.creditLedgerEntry.count({ where }),
        ]);

        return {
            entries,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    static async grantCredits(
        actor: AdminActorContext,
        tenantId: string,
        params: CreditLedgerMutationContext
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        const amount = normalizePositiveAmount(params.amount);
        await this.ensureTenantExists(tenantId);

        return this.writeAdminLedgerEntry({
            actor,
            tenantId,
            params: { ...params, amount, reason },
            entryType: CreditLedgerEntryType.GRANTED,
            amount,
            availableDelta: amount,
            reservedDelta: 0,
            action: CREDIT_LEDGER_ACTIONS.CREDIT_GRANTED,
        });
    }

    static async adjustCredits(
        actor: AdminActorContext,
        tenantId: string,
        params: AdjustCreditsParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        const delta = normalizeNonZeroDelta(params.delta);
        await this.ensureTenantExists(tenantId);

        if (delta < 0) {
            const balance = await this.getBalanceProjection(prisma, tenantId, params.userId);
            if (balance.available + delta < 0) {
                throw new CreditLedgerError('INSUFFICIENT_CREDITS', 'Available credits cannot become negative.');
            }
        }

        return this.writeAdminLedgerEntry({
            actor,
            tenantId,
            params: { ...params, amount: Math.abs(delta), reason },
            entryType: CreditLedgerEntryType.ADJUSTED,
            amount: Math.abs(delta),
            availableDelta: delta,
            reservedDelta: 0,
            action: CREDIT_LEDGER_ACTIONS.CREDIT_ADJUSTED,
        });
    }

    static async revokeCredits(
        actor: AdminActorContext,
        tenantId: string,
        params: CreditLedgerMutationContext
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        const amount = normalizePositiveAmount(params.amount);
        await this.ensureTenantExists(tenantId);

        const balance = await this.getBalanceProjection(prisma, tenantId, params.userId);
        if (balance.available < amount) {
            throw new CreditLedgerError('INSUFFICIENT_CREDITS', 'There are not enough available credits to revoke.');
        }

        return this.writeAdminLedgerEntry({
            actor,
            tenantId,
            params: { ...params, amount, reason },
            entryType: CreditLedgerEntryType.REVOKED,
            amount,
            availableDelta: -amount,
            reservedDelta: 0,
            action: CREDIT_LEDGER_ACTIONS.CREDIT_REVOKED,
        });
    }

    static async reserveCredits(params: OperationalCreditsParams) {
        const amount = normalizePositiveAmount(params.amount);
        validateIdempotencyKey(params.idempotencyKey);

        return prisma.$transaction(async (tx) => {
            const existing = await this.findIdempotentEntry(tx, params.tenantId, params.idempotencyKey);
            if (existing) return existing;

            const balance = await this.getBalanceProjection(tx, params.tenantId, params.userId);
            if (balance.available < amount) {
                throw new CreditLedgerError('INSUFFICIENT_CREDITS', 'There are not enough available credits to reserve.');
            }

            return this.createLedgerEntry(tx, {
                ...params,
                amount,
                entryType: CreditLedgerEntryType.RESERVED,
                availableDelta: -amount,
                reservedDelta: amount,
            });
        });
    }

    static async consumeReservedCredits(params: OperationalCreditsParams) {
        const amount = normalizePositiveAmount(params.amount);
        validateIdempotencyKey(params.idempotencyKey);

        return prisma.$transaction(async (tx) => {
            const existing = await this.findIdempotentEntry(tx, params.tenantId, params.idempotencyKey);
            if (existing) return existing;

            const balance = await this.getBalanceProjection(tx, params.tenantId, params.userId);
            if (balance.reserved < amount) {
                throw new CreditLedgerError('INSUFFICIENT_RESERVED_CREDITS', 'There are not enough reserved credits to consume.');
            }

            return this.createLedgerEntry(tx, {
                ...params,
                amount,
                entryType: CreditLedgerEntryType.CONSUMED,
                availableDelta: 0,
                reservedDelta: -amount,
            });
        });
    }

    static async releaseReservedCredits(params: OperationalCreditsParams) {
        const amount = normalizePositiveAmount(params.amount);
        validateIdempotencyKey(params.idempotencyKey);

        return prisma.$transaction(async (tx) => {
            const existing = await this.findIdempotentEntry(tx, params.tenantId, params.idempotencyKey);
            if (existing) return existing;

            const balance = await this.getBalanceProjection(tx, params.tenantId, params.userId);
            if (balance.reserved < amount) {
                throw new CreditLedgerError('INSUFFICIENT_RESERVED_CREDITS', 'There are not enough reserved credits to release.');
            }

            return this.createLedgerEntry(tx, {
                ...params,
                amount,
                entryType: CreditLedgerEntryType.RELEASED,
                availableDelta: amount,
                reservedDelta: -amount,
            });
        });
    }

    static async recordPurchasedCredits(
        tx: any,
        params: OperationalCreditsParams
    ) {
        const amount = normalizePositiveAmount(params.amount);
        validateIdempotencyKey(params.idempotencyKey);

        const existing = await this.findIdempotentEntry(tx, params.tenantId, params.idempotencyKey);
        if (existing) return existing;

        return this.createLedgerEntry(tx, {
            ...params,
            amount,
            entryType: CreditLedgerEntryType.PURCHASED,
            availableDelta: amount,
            reservedDelta: 0,
        });
    }

    private static async writeAdminLedgerEntry(params: {
        actor: AdminActorContext;
        tenantId: string;
        params: CreditLedgerMutationContext;
        entryType: CreditLedgerEntryType;
        amount: number;
        availableDelta: number;
        reservedDelta: number;
        action: string;
    }) {
        return prisma.$transaction(async (tx) => {
            if (params.params.idempotencyKey) {
                const existing = await this.findIdempotentEntry(
                    tx,
                    params.tenantId,
                    params.params.idempotencyKey
                );
                if (existing) return existing;
            }

            const entry = await this.createLedgerEntry(tx, {
                tenantId: params.tenantId,
                userId: params.params.userId,
                amount: params.amount,
                entryType: params.entryType,
                availableDelta: params.availableDelta,
                reservedDelta: params.reservedDelta,
                idempotencyKey: params.params.idempotencyKey,
                referenceType: params.params.referenceType,
                referenceId: params.params.referenceId,
                reason: params.params.reason,
                actorUserId: params.actor.actorUserId,
                metadata: params.params.metadata,
            });

            await tx.adminAuditLog.create({
                data: {
                    tenantId: params.tenantId,
                    actorUserId: params.actor.actorUserId,
                    actorTenantId: params.actor.actorTenantId,
                    action: params.action,
                    resourceType: ResourceTypes.CREDIT_LEDGER_ENTRY,
                    resourceId: entry.id,
                    reason: params.params.reason,
                    correlationId: params.actor.correlationId,
                    metadata: {
                        amount: params.amount,
                        availableDelta: params.availableDelta,
                        reservedDelta: params.reservedDelta,
                        entryType: params.entryType,
                        userId: params.params.userId ?? null,
                        referenceType: params.params.referenceType ?? null,
                        referenceId: params.params.referenceId ?? null,
                        facet: DiamondFacets.CREDIT_LEDGER,
                    },
                    ipAddress: params.params.ipAddress,
                    userAgent: params.params.userAgent,
                },
            });

            return entry;
        });
    }

    private static async createLedgerEntry(
        tx: any,
        params: Omit<OperationalCreditsParams, 'idempotencyKey'> & {
            idempotencyKey?: string;
            entryType: CreditLedgerEntryType;
            availableDelta: number;
            reservedDelta: number;
            actorUserId?: string;
        }
    ) {
        return tx.creditLedgerEntry.create({
            data: {
                tenantId: params.tenantId,
                userId: params.userId || undefined,
                purchaseOrderId: params.purchaseOrderId || undefined,
                entryType: params.entryType,
                amount: params.amount,
                availableDelta: params.availableDelta,
                reservedDelta: params.reservedDelta,
                referenceType: params.referenceType,
                referenceId: params.referenceId,
                idempotencyKey: params.idempotencyKey,
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
    ): Promise<CreditLedgerEntry | null> {
        if (!idempotencyKey) return null;
        return tx.creditLedgerEntry.findUnique({
            where: {
                tenantId_idempotencyKey: {
                    tenantId,
                    idempotencyKey,
                },
            },
        });
    }

    private static async getBalanceProjection(tx: any, tenantId: string, userId?: string | null) {
        const entries = await tx.creditLedgerEntry.findMany({
            where: {
                tenantId,
                ...(userId ? { userId } : {}),
            },
            select: {
                entryType: true,
                amount: true,
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
            acc.byType[entry.entryType] = (acc.byType[entry.entryType] || 0) + entry.amount;
            return acc;
        }, {
            available: 0,
            reserved: 0,
            byType: {} as Record<string, number>,
        });

        return {
            tenantId,
            userId: userId ?? null,
            available: totals.available,
            reserved: totals.reserved,
            total: totals.available + totals.reserved,
            purchased: totals.byType[CreditLedgerEntryType.PURCHASED] || 0,
            granted: totals.byType[CreditLedgerEntryType.GRANTED] || 0,
            adjusted: totals.byType[CreditLedgerEntryType.ADJUSTED] || 0,
            consumed: totals.byType[CreditLedgerEntryType.CONSUMED] || 0,
            revoked: totals.byType[CreditLedgerEntryType.REVOKED] || 0,
            entryCount: entries.length,
        };
    }

    private static ensurePlatformActor(actor?: AdminActorContext) {
        if (!actor?.actorUserId) {
            throw new CreditLedgerError('ADMIN_ACTOR_REQUIRED', 'Platform admin actor is required.');
        }

        if (actor.role !== TenantMembershipRole.PLATFORM_ADMIN) {
            throw new CreditLedgerError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }
    }

    private static async ensureTenantExists(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });

        if (!tenant) {
            throw new CreditLedgerError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }
    }
}

function buildLedgerWhere(
    tenantId: string,
    params: ListLedgerParams
): Prisma.CreditLedgerEntryWhereInput {
    return {
        tenantId,
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.entryType ? { entryType: params.entryType } : {}),
    };
}

function normalizePositiveAmount(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new CreditLedgerError('INVALID_AMOUNT', 'Credit amount must be a positive integer.');
    }
    return value;
}

function normalizeNonZeroDelta(value: number): number {
    if (!Number.isInteger(value) || value === 0) {
        throw new CreditLedgerError('INVALID_AMOUNT', 'Credit adjustment must be a non-zero integer.');
    }
    return value;
}

function validateIdempotencyKey(value?: string) {
    if (!value?.trim()) {
        throw new CreditLedgerError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key is required for credit ledger operations.');
    }
}

function normalizePage(value?: number): number {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizeLimit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(Math.floor(value), 100);
}

export class CreditLedgerError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'CreditLedgerError';
    }
}
