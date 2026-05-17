import prisma from '../../config/prisma';
import { randomUUID } from 'crypto';
import {
    AssetStatus,
    EventStatus,
    PlanTier,
    Prisma,
    TenantMembershipRole,
    TenantStatus,
} from '@prisma/client';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';
import { AnchorQueueService } from '../AnchorQueueService';
import { AssetAnchoringService } from '../AssetAnchoringService';
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

const TENANT_PROFILE_ASSET_KIND = 'TENANT_PROFILE';
const TENANT_PROFILE_EVENT_ORIGIN = 'SYSTEM_TENANT_PROFILE';
const TENANT_PROFILE_PUBLIC_DATA_KEYS = ['assetKind', 'tenant'];

const TENANT_PROFILE_ASSET_SELECT = {
    id: true,
    tenantId: true,
    externalId: true,
    publicUrl: true,
    status: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.AssetSelect;

const TENANT_PROFILE_ANCHOR_EVENT_SELECT = {
    id: true,
    status: true,
    dltTxId: true,
    signatureHash: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.EventLogSelect;

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

        return this.attachTenantProfileAsset(tenant);
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

        const result = await prisma.$transaction(async (tx) => {
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

            const profileAsset = await this.upsertTenantProfileAsset(tx, {
                tenant,
                commercialProfile,
                actor,
                reason,
                eventType: 'TENANT_PROFILE_CREATED',
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
                profileAsset,
            };
        });

        AnchorQueueService.processQueue({ tenantId: result.id }).catch(console.error);

        return result;
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

        const result = await prisma.$transaction(async (tx) => {
            let tenant;

            if (Object.keys(tenantData).length > 0) {
                tenant = await tx.tenant.update({
                    where: { id: tenantId },
                    data: tenantData,
                });
            } else {
                tenant = await tx.tenant.findUnique({
                    where: { id: tenantId },
                });
            }

            if (!tenant) {
                throw new AdminTenantError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
            }

            const commercialProfile = await tx.tenantCommercialProfile.upsert({
                where: { tenantId },
                create: {
                    tenantId,
                    ...profileData,
                },
                update: profileData,
            });

            const profileAsset = await this.upsertTenantProfileAsset(tx, {
                tenant,
                commercialProfile,
                actor,
                reason,
                eventType: 'TENANT_PROFILE_UPDATED',
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

            const updatedTenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                include: TENANT_INCLUDE,
            });

            return updatedTenant ? {
                ...updatedTenant,
                profileAsset,
            } : updatedTenant;
        });

        AnchorQueueService.processQueue({ tenantId }).catch(console.error);

        return result;
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

    private static async attachTenantProfileAsset<T extends { id: string }>(tenant: T) {
        const profileAsset = await prisma.asset.findUnique({
            where: {
                tenantId_externalId: {
                    tenantId: tenant.id,
                    externalId: buildTenantProfileExternalId(tenant.id),
                },
            },
            select: TENANT_PROFILE_ASSET_SELECT,
        });

        if (!profileAsset) {
            return {
                ...tenant,
                profileAsset: null,
            };
        }

        const lastAnchorEvent = await prisma.eventLog.findFirst({
            where: {
                tenantId: tenant.id,
                assetId: profileAsset.id,
                origin: TENANT_PROFILE_EVENT_ORIGIN,
            },
            orderBy: { createdAt: 'desc' },
            select: TENANT_PROFILE_ANCHOR_EVENT_SELECT,
        });

        return {
            ...tenant,
            profileAsset: {
                ...profileAsset,
                lastAnchorEvent,
            },
        };
    }

    private static async upsertTenantProfileAsset(
        tx: any,
        params: {
            tenant: any;
            commercialProfile: any;
            actor: AdminActorContext;
            reason: string;
            eventType: 'TENANT_PROFILE_CREATED' | 'TENANT_PROFILE_UPDATED';
        }
    ) {
        const externalId = buildTenantProfileExternalId(params.tenant.id);
        const assetId = randomUUID();
        const metadata = buildTenantProfileAssetMetadata(params.tenant, params.commercialProfile);

        const profileAsset = await tx.asset.upsert({
            where: {
                tenantId_externalId: {
                    tenantId: params.tenant.id,
                    externalId,
                },
            },
            create: {
                id: assetId,
                tenantId: params.tenant.id,
                externalId,
                status: AssetStatus.ACTIVE,
                metadata,
                publicDataKeys: TENANT_PROFILE_PUBLIC_DATA_KEYS,
                publicUrl: buildPublicAssetUrl(assetId),
            },
            update: {
                status: AssetStatus.ACTIVE,
                metadata,
                publicDataKeys: TENANT_PROFILE_PUBLIC_DATA_KEYS,
            },
        });

        const payload = buildTenantProfileEventPayload({
            eventType: params.eventType,
            tenant: params.tenant,
            commercialProfile: params.commercialProfile,
            profileAsset,
            actor: params.actor,
            reason: params.reason,
        });

        const lastAnchorEvent = await tx.eventLog.create({
            data: {
                assetId: profileAsset.id,
                tenantId: params.tenant.id,
                origin: TENANT_PROFILE_EVENT_ORIGIN,
                issuerId: params.actor.actorUserId,
                status: EventStatus.APPROVED,
                payload,
                signatureHash: AssetAnchoringService.signatureHash(payload),
                dltTxId: null,
            },
            select: TENANT_PROFILE_ANCHOR_EVENT_SELECT,
        });

        return {
            ...profileAsset,
            lastAnchorEvent,
        };
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

function buildTenantProfileExternalId(tenantId: string): string {
    return `tenant-profile:${tenantId}`;
}

function buildPublicAssetUrl(assetId: string): string {
    const baseUrl = process.env.PUBLIC_URL_BASE || 'https://api.domain.com';
    return `${baseUrl}/v1/public/asset/${assetId}`;
}

function buildTenantProfileAssetMetadata(tenant: any, commercialProfile: any): Prisma.InputJsonObject {
    return {
        assetKind: TENANT_PROFILE_ASSET_KIND,
        schemaVersion: 1,
        tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            contactEmail: tenant.contactEmail,
            status: tenant.status,
            isActive: tenant.isActive,
            planTier: tenant.planTier,
        },
        commercialProfile: normalizeCommercialProfileSnapshot(commercialProfile),
        profileUpdatedAt: toIsoString(commercialProfile?.updatedAt),
    };
}

function buildTenantProfileEventPayload(params: {
    eventType: 'TENANT_PROFILE_CREATED' | 'TENANT_PROFILE_UPDATED';
    tenant: any;
    commercialProfile: any;
    profileAsset: any;
    actor: AdminActorContext;
    reason: string;
}): Prisma.InputJsonObject {
    return {
        eventType: params.eventType,
        schemaVersion: 1,
        tenantId: params.tenant.id,
        profileAssetId: params.profileAsset.id,
        profileAssetExternalId: params.profileAsset.externalId,
        tenant: {
            id: params.tenant.id,
            name: params.tenant.name,
            slug: params.tenant.slug,
            status: params.tenant.status,
            planTier: params.tenant.planTier,
        },
        commercialProfile: normalizeCommercialProfileSnapshot(params.commercialProfile),
        reason: params.reason,
        updatedByActorId: params.actor.actorUserId,
        actorTenantId: params.actor.actorTenantId ?? null,
        recordedAt: new Date().toISOString(),
    };
}

function normalizeCommercialProfileSnapshot(commercialProfile: any): Prisma.InputJsonObject {
    return {
        legalName: commercialProfile?.legalName ?? null,
        taxId: commercialProfile?.taxId ?? null,
        taxIdType: commercialProfile?.taxIdType ?? null,
        contactName: commercialProfile?.contactName ?? null,
        contactEmail: commercialProfile?.contactEmail ?? null,
        contactPhone: commercialProfile?.contactPhone ?? null,
        billingOwner: commercialProfile?.billingOwner ?? null,
        commercialPlan: commercialProfile?.commercialPlan ?? null,
        limits: normalizeJsonObject(commercialProfile?.limits),
        whiteLabel: normalizeJsonObject(commercialProfile?.whiteLabel),
        internalNotes: commercialProfile?.internalNotes ?? null,
    };
}

function toIsoString(value?: Date | string | null): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.length > 0) return value;
    return new Date().toISOString();
}

export class AdminTenantError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminTenantError';
    }
}
