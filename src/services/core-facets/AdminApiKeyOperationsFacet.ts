import prisma from '../../config/prisma';
import {
    ApiKeyRole,
    Prisma,
    TenantMembershipRole,
    TenantStatus,
} from '@prisma/client';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';
import { normalizeApiKeyScopes, resolveEffectiveApiKeyScopes } from '../../security/apiKeyScopes';
import { AdminAuthorizationFacet } from './AdminAuthorizationFacet';
import { ApiKeyManagementFacet } from './ApiKeyManagementFacet';

type AdminApiKeyMutationContext = {
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
};

type CreateInitialApiKeyParams = AdminApiKeyMutationContext & {
    label: string;
    role?: ApiKeyRole;
    scopes?: string[];
    expiresAt?: Date | null;
};

type RotateApiKeyParams = AdminApiKeyMutationContext & {
    label?: string;
    expiresAt?: Date | null;
};

type ListApiKeyParams = {
    includeRevoked?: boolean;
    page?: number;
    limit?: number;
};

type ListRequestAuditParams = {
    page?: number;
    limit?: number;
    apiKeyId?: string;
    keyPrefix?: string;
    selector?: string;
    correlationId?: string;
    statusCode?: number;
    statusFrom?: number;
    statusTo?: number;
    from?: Date;
    to?: Date;
};

const ADMIN_API_KEY_ACTIONS = {
    API_KEY_INITIAL_CREATED: 'API_KEY_INITIAL_CREATED',
    API_KEY_ROTATED: 'API_KEY_ROTATED',
    API_KEY_REVOKED: 'API_KEY_REVOKED',
} as const;

const API_KEY_SELECT = {
    id: true,
    tenantId: true,
    keyPrefix: true,
    label: true,
    role: true,
    scopes: true,
    isActive: true,
    revokedAt: true,
    lastUsedAt: true,
    expiresAt: true,
    createdByActorId: true,
    revokedByActorId: true,
    revocationReason: true,
    rotatedFromApiKeyId: true,
    lastRotatedAt: true,
    createdAt: true,
} satisfies Prisma.ApiKeySelect;

const API_REQUEST_AUDIT_SELECT = {
    id: true,
    tenantId: true,
    apiKeyId: true,
    keyPrefix: true,
    role: true,
    method: true,
    path: true,
    selector: true,
    statusCode: true,
    latencyMs: true,
    correlationId: true,
    sanitizedError: true,
    ipAddress: true,
    userAgent: true,
    createdAt: true,
} satisfies Prisma.ApiRequestAuditSelect;

export class AdminApiKeyOperationsFacet {
    static async createInitialApiKey(
        actor: AdminActorContext,
        tenantId: string,
        params: CreateInitialApiKeyParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        await this.ensureTenantAllowsKeys(tenantId);

        const existingActiveKey = await prisma.apiKey.findFirst({
            where: {
                tenantId,
                isActive: true,
                revokedAt: null,
            },
            select: { id: true, keyPrefix: true },
        });

        if (existingActiveKey) {
            throw new AdminApiKeyOperationsError(
                'INITIAL_KEY_ALREADY_EXISTS',
                'Tenant already has an active API key. Rotate or revoke the existing key first.'
            );
        }

        const label = normalizeRequiredLabel(params.label);
        const role = params.role || ApiKeyRole.OPERATOR;
        const scopes = normalizeApiKeyScopes(params.scopes, role);
        const { rawKey, keyHash, keyPrefix } = await ApiKeyManagementFacet.buildKeyMaterial();

        const apiKey = await prisma.$transaction(async (tx) => {
            const newKey = await tx.apiKey.create({
                data: {
                    tenantId,
                    keyHash,
                    keyPrefix,
                    label,
                    role,
                    scopes,
                    expiresAt: params.expiresAt || undefined,
                    createdByActorId: actor.actorUserId,
                },
                select: API_KEY_SELECT,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: ADMIN_API_KEY_ACTIONS.API_KEY_INITIAL_CREATED,
                resourceId: newKey.id,
                reason,
                metadata: {
                    keyPrefix,
                    role,
                    scopes,
                    hasExpiration: !!params.expiresAt,
                    facet: DiamondFacets.ADMIN_API_KEY_OPERATIONS,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return newKey;
        });

        return {
            ...apiKey,
            rawKey,
            warning: 'Store this key securely. It will not be shown again.',
        };
    }

    static async listTenantApiKeys(
        actor: AdminActorContext,
        tenantId: string,
        params: ListApiKeyParams = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where: Prisma.ApiKeyWhereInput = { tenantId };

        if (!params.includeRevoked) {
            where.isActive = true;
            where.revokedAt = null;
        }

        const [apiKeys, total] = await Promise.all([
            prisma.apiKey.findMany({
                where,
                skip,
                take: limit,
                select: API_KEY_SELECT,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.apiKey.count({ where }),
        ]);

        return {
            apiKeys,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    static async rotateApiKey(
        actor: AdminActorContext,
        tenantId: string,
        apiKeyId: string,
        params: RotateApiKeyParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);

        const existingKey = await prisma.apiKey.findFirst({
            where: {
                id: apiKeyId,
                tenantId,
                isActive: true,
                revokedAt: null,
            },
            select: API_KEY_SELECT,
        });

        if (!existingKey) {
            throw new AdminApiKeyOperationsError('KEY_NOT_FOUND', 'Active API key not found for this tenant.');
        }

        const { rawKey, keyHash, keyPrefix } = await ApiKeyManagementFacet.buildKeyMaterial();
        const now = new Date();
        const scopes = resolveEffectiveApiKeyScopes(existingKey.scopes, existingKey.role);

        const apiKey = await prisma.$transaction(async (tx) => {
            await tx.apiKey.update({
                where: { id: apiKeyId },
                data: {
                    isActive: false,
                    revokedAt: now,
                    revokedByActorId: actor.actorUserId,
                    revocationReason: reason,
                    lastRotatedAt: now,
                },
            });

            const newKey = await tx.apiKey.create({
                data: {
                    tenantId,
                    keyHash,
                    keyPrefix,
                    label: normalizeOptionalLabel(params.label) ?? existingKey.label,
                    role: existingKey.role,
                    scopes,
                    expiresAt: params.expiresAt === undefined ? existingKey.expiresAt : params.expiresAt,
                    createdByActorId: actor.actorUserId,
                    rotatedFromApiKeyId: apiKeyId,
                },
                select: API_KEY_SELECT,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: ADMIN_API_KEY_ACTIONS.API_KEY_ROTATED,
                resourceId: newKey.id,
                reason,
                metadata: {
                    previousKeyId: apiKeyId,
                    previousKeyPrefix: existingKey.keyPrefix,
                    newKeyPrefix: keyPrefix,
                    role: existingKey.role,
                    scopes,
                    facet: DiamondFacets.ADMIN_API_KEY_OPERATIONS,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return newKey;
        });

        return {
            ...apiKey,
            rawKey,
            previousKeyId: apiKeyId,
            warning: 'Store this key securely. It will not be shown again.',
        };
    }

    static async revokeApiKey(
        actor: AdminActorContext,
        tenantId: string,
        apiKeyId: string,
        params: AdminApiKeyMutationContext
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);

        const existingKey = await prisma.apiKey.findFirst({
            where: {
                id: apiKeyId,
                tenantId,
            },
            select: API_KEY_SELECT,
        });

        if (!existingKey) {
            throw new AdminApiKeyOperationsError('KEY_NOT_FOUND', 'API key not found for this tenant.');
        }

        if (!existingKey.isActive || existingKey.revokedAt) {
            throw new AdminApiKeyOperationsError('KEY_ALREADY_REVOKED', 'This API key is already revoked.');
        }

        const apiKey = await prisma.$transaction(async (tx) => {
            const revoked = await tx.apiKey.update({
                where: { id: apiKeyId },
                data: {
                    isActive: false,
                    revokedAt: new Date(),
                    revokedByActorId: actor.actorUserId,
                    revocationReason: reason,
                },
                select: API_KEY_SELECT,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: ADMIN_API_KEY_ACTIONS.API_KEY_REVOKED,
                resourceId: apiKeyId,
                reason,
                metadata: {
                    revokedKeyPrefix: existingKey.keyPrefix,
                    role: existingKey.role,
                    scopes: existingKey.scopes,
                    facet: DiamondFacets.ADMIN_API_KEY_OPERATIONS,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return revoked;
        });

        return apiKey;
    }

    static async listRequestAudit(
        actor: AdminActorContext,
        tenantId: string,
        params: ListRequestAuditParams = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where = buildRequestAuditWhere(tenantId, params);

        const [requests, total] = await Promise.all([
            prisma.apiRequestAudit.findMany({
                where,
                skip,
                take: limit,
                select: API_REQUEST_AUDIT_SELECT,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.apiRequestAudit.count({ where }),
        ]);

        return {
            requests,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    private static ensurePlatformActor(actor?: AdminActorContext) {
        if (!actor?.actorUserId) {
            throw new AdminApiKeyOperationsError('ADMIN_ACTOR_REQUIRED', 'Platform admin actor is required.');
        }

        if (actor.role !== TenantMembershipRole.PLATFORM_ADMIN) {
            throw new AdminApiKeyOperationsError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }
    }

    private static async ensureTenantExists(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });

        if (!tenant) {
            throw new AdminApiKeyOperationsError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }
    }

    private static async ensureTenantAllowsKeys(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                isActive: true,
                status: true,
            },
        });

        if (!tenant) {
            throw new AdminApiKeyOperationsError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }

        if (!tenant.isActive || tenant.status !== TenantStatus.ACTIVE) {
            throw new AdminApiKeyOperationsError(
                'TENANT_NOT_ACTIVE',
                'API keys can only be issued for active tenants.'
            );
        }
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
                resourceType: ResourceTypes.API_KEY,
                resourceId: params.resourceId,
                reason: params.reason,
                correlationId: params.actor.correlationId,
                metadata: params.metadata,
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            },
        });
    }
}

function normalizeRequiredLabel(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new AdminApiKeyOperationsError('INVALID_LABEL', 'API key label is required.');
    }
    return normalized;
}

function normalizeOptionalLabel(value?: string): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}

function normalizePage(value?: number): number {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizeLimit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(Math.floor(value), 100);
}

function buildRequestAuditWhere(
    tenantId: string,
    params: ListRequestAuditParams
): Prisma.ApiRequestAuditWhereInput {
    const where: Prisma.ApiRequestAuditWhereInput = { tenantId };

    if (params.apiKeyId) where.apiKeyId = params.apiKeyId;
    if (params.keyPrefix) where.keyPrefix = params.keyPrefix;
    if (params.selector) where.selector = params.selector;
    if (params.correlationId) where.correlationId = params.correlationId;
    if (params.statusCode) where.statusCode = params.statusCode;
    if (params.statusFrom || params.statusTo) {
        where.statusCode = {
            ...(params.statusFrom ? { gte: params.statusFrom } : {}),
            ...(params.statusTo ? { lte: params.statusTo } : {}),
        };
    }
    if (params.from || params.to) {
        where.createdAt = {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
        };
    }

    return where;
}

export class AdminApiKeyOperationsError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminApiKeyOperationsError';
    }
}
