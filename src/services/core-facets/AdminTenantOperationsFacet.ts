import prisma from '../../config/prisma';
import {
    PlanTier,
    Prisma,
    TenantMembershipRole,
    TenantStatus,
} from '@prisma/client';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';
import { AdminAuthorizationFacet } from './AdminAuthorizationFacet';

type CommercialProfileInput = {
    legalName?: string | null;
    taxId?: string | null;
    taxIdType?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    billingOwner?: string | null;
    commercialPlan?: string | null;
    limits?: unknown;
    whiteLabel?: unknown;
    internalNotes?: string | null;
};

type CommercialProfileData = Omit<Prisma.TenantCommercialProfileUncheckedCreateInput, 'tenantId'>;

type TenantMutationContext = {
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
};

type TenantListParams = {
    page?: number;
    limit?: number;
    status?: TenantStatus;
    planTier?: PlanTier;
    search?: string;
};

type CreateTenantParams = TenantMutationContext & {
    name: string;
    slug: string;
    contactEmail: string;
    planTier?: PlanTier;
    maxRequestsPerMinute?: number | null;
    maxRequestsPerDay?: number | null;
    commercialProfile?: CommercialProfileInput;
};

type UpdateCommercialProfileParams = TenantMutationContext & {
    name?: string;
    contactEmail?: string;
    planTier?: PlanTier;
    maxRequestsPerMinute?: number | null;
    maxRequestsPerDay?: number | null;
    commercialProfile: CommercialProfileInput;
};

const TENANT_INCLUDE = {
    commercialProfile: true,
    _count: {
        select: {
            apiKeys: { where: { isActive: true } },
            assets: true,
            tenantUsers: true,
        },
    },
} satisfies Prisma.TenantInclude;

const ADMIN_TENANT_ACTIONS = {
    TENANT_CREATED: 'TENANT_CREATED',
    TENANT_PROFILE_UPDATED: 'TENANT_PROFILE_UPDATED',
    TENANT_SUBMITTED_FOR_REVIEW: 'TENANT_SUBMITTED_FOR_REVIEW',
    TENANT_ACTIVATED: 'TENANT_ACTIVATED',
    TENANT_SUSPENDED: 'TENANT_SUSPENDED',
    TENANT_ARCHIVED: 'TENANT_ARCHIVED',
} as const;

export class AdminTenantOperationsFacet {
    static async listTenants(actor: AdminActorContext, params: TenantListParams = {}) {
        this.ensurePlatformActor(actor);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where = buildTenantWhere(params);

        const [tenants, total] = await Promise.all([
            prisma.tenant.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: TENANT_INCLUDE,
            }),
            prisma.tenant.count({ where }),
        ]);

        return {
            tenants,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    static async getTenant(actor: AdminActorContext, tenantId: string) {
        this.ensurePlatformActor(actor);

        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            include: TENANT_INCLUDE,
        });

        if (!tenant) {
            throw new AdminTenantError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }

        return tenant;
    }

    static async createTenant(actor: AdminActorContext, params: CreateTenantParams) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        const slug = normalizeSlug(params.slug);

        const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
        if (existingTenant) {
            throw new AdminTenantError('SLUG_ALREADY_EXISTS', `Tenant slug "${slug}" is already in use.`);
        }

        const profileData = buildCommercialProfileData(params.commercialProfile);
        profileData.contactEmail ??= params.contactEmail;
        profileData.legalName ??= params.name;

        return prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    name: params.name.trim(),
                    slug,
                    contactEmail: params.contactEmail.trim().toLowerCase(),
                    planTier: params.planTier || PlanTier.FREE,
                    maxRequestsPerMinute: params.maxRequestsPerMinute,
                    maxRequestsPerDay: params.maxRequestsPerDay,
                    status: TenantStatus.DRAFT,
                    isActive: false,
                },
            });

            const commercialProfile = await tx.tenantCommercialProfile.create({
                data: {
                    tenantId: tenant.id,
                    ...profileData,
                },
            });

            await this.createAdminAuditLog(tx, {
                tenantId: tenant.id,
                actor,
                action: ADMIN_TENANT_ACTIONS.TENANT_CREATED,
                reason,
                metadata: {
                    status: TenantStatus.DRAFT,
                    planTier: params.planTier || PlanTier.FREE,
                    facet: DiamondFacets.ADMIN_TENANT_OPERATIONS,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return {
                ...tenant,
                commercialProfile,
            };
        });
    }

    static async updateCommercialProfile(
        actor: AdminActorContext,
        tenantId: string,
        params: UpdateCommercialProfileParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        await this.ensureTenantExists(tenantId);

        const tenantData = buildTenantUpdateData(params);
        const profileData = buildCommercialProfileData(params.commercialProfile);

        return prisma.$transaction(async (tx) => {
            if (Object.keys(tenantData).length > 0) {
                await tx.tenant.update({
                    where: { id: tenantId },
                    data: tenantData,
                });
            }

            await tx.tenantCommercialProfile.upsert({
                where: { tenantId },
                create: {
                    tenantId,
                    ...profileData,
                },
                update: profileData,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: ADMIN_TENANT_ACTIONS.TENANT_PROFILE_UPDATED,
                reason,
                metadata: {
                    updatedTenantFields: Object.keys(tenantData),
                    updatedProfileFields: Object.keys(profileData),
                    facet: DiamondFacets.ADMIN_TENANT_OPERATIONS,
                },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            });

            return tx.tenant.findUnique({
                where: { id: tenantId },
                include: TENANT_INCLUDE,
            });
        });
    }

    static async submitForReview(actor: AdminActorContext, tenantId: string, context: TenantMutationContext) {
        return this.transitionTenant({
            actor,
            tenantId,
            targetStatus: TenantStatus.PENDING_REVIEW,
            action: ADMIN_TENANT_ACTIONS.TENANT_SUBMITTED_FOR_REVIEW,
            isActive: false,
            context,
        });
    }

    static async activateTenant(actor: AdminActorContext, tenantId: string, context: TenantMutationContext) {
        return this.transitionTenant({
            actor,
            tenantId,
            targetStatus: TenantStatus.ACTIVE,
            action: ADMIN_TENANT_ACTIONS.TENANT_ACTIVATED,
            isActive: true,
            context,
            timestampField: 'activatedAt',
        });
    }

    static async suspendTenant(actor: AdminActorContext, tenantId: string, context: TenantMutationContext) {
        return this.transitionTenant({
            actor,
            tenantId,
            targetStatus: TenantStatus.SUSPENDED,
            action: ADMIN_TENANT_ACTIONS.TENANT_SUSPENDED,
            isActive: false,
            context,
            timestampField: 'suspendedAt',
        });
    }

    static async archiveTenant(actor: AdminActorContext, tenantId: string, context: TenantMutationContext) {
        return this.transitionTenant({
            actor,
            tenantId,
            targetStatus: TenantStatus.ARCHIVED,
            action: ADMIN_TENANT_ACTIONS.TENANT_ARCHIVED,
            isActive: false,
            context,
            timestampField: 'archivedAt',
        });
    }

    private static async transitionTenant(params: {
        actor: AdminActorContext;
        tenantId: string;
        targetStatus: TenantStatus;
        action: string;
        isActive: boolean;
        context: TenantMutationContext;
        timestampField?: 'activatedAt' | 'suspendedAt' | 'archivedAt';
    }) {
        this.ensurePlatformActor(params.actor);
        const reason = AdminAuthorizationFacet.requireReason(params.context.reason || params.actor.reason);
        await this.ensureTenantExists(params.tenantId);

        return prisma.$transaction(async (tx) => {
            const data: Prisma.TenantUpdateInput = {
                status: params.targetStatus,
                isActive: params.isActive,
                statusReason: reason,
            };

            if (params.timestampField) {
                data[params.timestampField] = new Date();
            }

            const tenant = await tx.tenant.update({
                where: { id: params.tenantId },
                data,
                include: TENANT_INCLUDE,
            });

            await this.createAdminAuditLog(tx, {
                tenantId: params.tenantId,
                actor: params.actor,
                action: params.action,
                reason,
                metadata: {
                    status: params.targetStatus,
                    isActive: params.isActive,
                    facet: DiamondFacets.ADMIN_TENANT_OPERATIONS,
                },
                ipAddress: params.context.ipAddress,
                userAgent: params.context.userAgent,
            });

            return tenant;
        });
    }

    private static async ensureTenantExists(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });

        if (!tenant) {
            throw new AdminTenantError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }
    }

    private static ensurePlatformActor(actor?: AdminActorContext) {
        if (!actor?.actorUserId) {
            throw new AdminTenantError('ADMIN_ACTOR_REQUIRED', 'Platform admin actor is required.');
        }

        if (actor.role !== TenantMembershipRole.PLATFORM_ADMIN) {
            throw new AdminTenantError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }
    }

    private static async createAdminAuditLog(
        tx: any,
        params: {
            tenantId: string;
            actor: AdminActorContext;
            action: string;
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
                resourceType: ResourceTypes.TENANT,
                resourceId: params.tenantId,
                reason: params.reason,
                correlationId: params.actor.correlationId,
                metadata: params.metadata,
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            },
        });
    }
}

function buildTenantWhere(params: TenantListParams): Prisma.TenantWhereInput {
    const where: Prisma.TenantWhereInput = {};

    if (params.status) where.status = params.status;
    if (params.planTier) where.planTier = params.planTier;

    const search = params.search?.trim();
    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
            { contactEmail: { contains: search, mode: 'insensitive' } },
            {
                commercialProfile: {
                    is: {
                        legalName: { contains: search, mode: 'insensitive' },
                    },
                },
            },
            {
                commercialProfile: {
                    is: {
                        taxId: { contains: normalizeTaxId(search) || search },
                    },
                },
            },
        ];
    }

    return where;
}

function buildTenantUpdateData(params: UpdateCommercialProfileParams): Prisma.TenantUpdateInput {
    const data: Prisma.TenantUpdateInput = {};

    if (params.name !== undefined) data.name = params.name.trim();
    if (params.contactEmail !== undefined) data.contactEmail = params.contactEmail.trim().toLowerCase();
    if (params.planTier !== undefined) data.planTier = params.planTier;
    if (params.maxRequestsPerMinute !== undefined) data.maxRequestsPerMinute = params.maxRequestsPerMinute;
    if (params.maxRequestsPerDay !== undefined) data.maxRequestsPerDay = params.maxRequestsPerDay;

    return data;
}

function buildCommercialProfileData(input: CommercialProfileInput = {}): CommercialProfileData {
    const data: CommercialProfileData = {};

    if (input.legalName !== undefined) data.legalName = normalizeNullableString(input.legalName);
    if (input.taxId !== undefined) data.taxId = normalizeTaxId(input.taxId);
    if (input.taxIdType !== undefined) data.taxIdType = normalizeNullableString(input.taxIdType);
    if (input.contactName !== undefined) data.contactName = normalizeNullableString(input.contactName);
    if (input.contactEmail !== undefined) data.contactEmail = normalizeNullableString(input.contactEmail)?.toLowerCase();
    if (input.contactPhone !== undefined) data.contactPhone = normalizeNullableString(input.contactPhone);
    if (input.billingOwner !== undefined) data.billingOwner = normalizeNullableString(input.billingOwner);
    if (input.commercialPlan !== undefined) data.commercialPlan = normalizeNullableString(input.commercialPlan);
    if (input.limits !== undefined) data.limits = normalizeJsonObject(input.limits);
    if (input.whiteLabel !== undefined) data.whiteLabel = normalizeJsonObject(input.whiteLabel);
    if (input.internalNotes !== undefined) data.internalNotes = normalizeNullableString(input.internalNotes);

    return data;
}

function normalizeSlug(slug: string): string {
    const normalized = slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
        throw new AdminTenantError('INVALID_SLUG', 'Tenant slug must use lowercase letters, numbers and hyphens.');
    }
    return normalized;
}

function normalizeTaxId(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const normalized = value.replace(/\D/g, '');
    return normalized || null;
}

function normalizeNullableString(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    return normalized || null;
}

function normalizeJsonObject(value: unknown): Prisma.InputJsonValue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Prisma.InputJsonObject;
}

function normalizePage(value?: number): number {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizeLimit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(Math.floor(value), 100);
}

export class AdminTenantError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminTenantError';
    }
}
