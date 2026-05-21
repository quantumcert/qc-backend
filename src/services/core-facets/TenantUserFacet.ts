import prisma from '../../config/prisma';
import { createHash, randomUUID } from 'crypto';
import {
    AssetStatus,
    EventStatus,
    PlanTier,
    Prisma,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantStatus,
    TenantUserRole,
    TenantUserStatus,
} from '@prisma/client';
import { DEFAULT_TENANT_TARGET_CHAIN } from '../../config/tenantChains';
import {
    getPlatformTenantContactEmail,
    getPlatformTenantName,
    getPlatformTenantSlug,
    PREVIOUS_PLATFORM_TENANT_SLUG,
} from '../../config/platformTenant';
import { buildPublicVerifyUrl } from '../../utils/publicVerifyUrl';
import { AnchorQueueService } from '../AnchorQueueService';
import { AssetAnchoringService } from '../AssetAnchoringService';
import { AdminAuthorizationFacet } from './AdminAuthorizationFacet';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';
import { RegistrationCreditFacet } from './RegistrationCreditFacet';

type JsonRecord = Record<string, unknown>;

export type TenantUserUpsertInput = {
    tenantId?: string;
    legacyDashboardUserId?: string | number | null;
    legacyOpenId?: string | null;
    email?: string | null;
    phone?: string | null;
    cpf?: string | null;
    document?: string | null;
    documentType?: string | null;
    displayName?: string | null;
    role?: TenantUserRole;
    status?: TenantUserStatus;
    guardianId?: string | null;
    guardianLegacyDashboardUserId?: string | number | null;
    guardianLegacyOpenId?: string | null;
    profile?: JsonRecord | null;
    metadata?: JsonRecord | null;
    migratedAt?: Date | string | null;
    source?: string;
};

export type TenantUserDependentWithCreditInput = TenantUserUpsertInput & {
    idempotencyKey?: string;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
};

export type TenantUserProfileUpdateInput = {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    cpf?: string | null;
    document?: string | null;
    documentType?: string | null;
    profile?: JsonRecord | null;
    metadata?: JsonRecord | null;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
};

export type TenantUserListParams = {
    page?: number;
    limit?: number;
    search?: string;
    role?: TenantUserRole;
    status?: TenantUserStatus;
};

export type TenantUserCreateInput = TenantUserUpsertInput & {
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
};

export type TenantUserUpdateInput = TenantUserProfileUpdateInput & {
    role?: TenantUserRole;
    status?: TenantUserStatus;
};

type TenantUserLookupInput = {
    id?: string;
    legacyDashboardUserId?: string | number | null;
    legacyOpenId?: string | null;
    email?: string | null;
    document?: string | null;
    cpf?: string | null;
};

type TenantUserNormalizeInput = {
    tenantId?: string;
    legacyDashboardUserId?: string | number | null;
    legacyOpenId?: string | null;
    email?: string | null;
    phone?: string | null;
    cpf?: string | null;
    document?: string | null;
    documentType?: string | null;
    displayName?: string | null;
    role?: TenantUserRole;
    status?: TenantUserStatus;
    guardianId?: string | null;
    guardianLegacyDashboardUserId?: string | number | null;
    guardianLegacyOpenId?: string | null;
    profile?: JsonRecord | null;
    metadata?: JsonRecord | null;
    migratedAt?: Date | string | null;
};

type NormalizedTenantUserInput = {
    tenantId: string;
    legacyDashboardUserId: string | null;
    legacyOpenId: string | null;
    email: string | null;
    phone: string | null;
    document: string | null;
    documentType: string | null;
    displayName: string | null;
    role: TenantUserRole;
    status: TenantUserStatus;
    guardianId: string | null | undefined;
    profile: Prisma.InputJsonObject;
    metadata: Prisma.InputJsonObject;
    migratedAt?: Date;
};

const TENANT_USER_INCLUDE = {
    externalIdentities: true,
    memberships: true,
    dependents: true,
} satisfies Prisma.TenantUserInclude;

const TENANT_USER_PROFILE_ASSET_KIND = 'TENANT_USER_PROFILE';
const TENANT_USER_PROFILE_EVENT_ORIGIN = 'SYSTEM_TENANT_USER_PROFILE';
const TENANT_USER_PUBLIC_DATA_KEYS = ['assetKind', 'profile'];
const PROFILE_ASSET_ANCHOR_EVENT_CREATED = Symbol('profileAssetAnchorEventCreated');

const TENANT_USER_ACTIONS = {
    TENANT_USER_CREATED: 'TENANT_USER_CREATED',
    TENANT_USER_UPDATED: 'TENANT_USER_UPDATED',
    TENANT_USER_STATUS_CHANGED: 'TENANT_USER_STATUS_CHANGED',
    TENANT_USER_ROLE_ASSIGNED: 'TENANT_USER_ROLE_ASSIGNED',
    TENANT_USER_EXTERNAL_IDENTITY_LINKED: 'TENANT_USER_EXTERNAL_IDENTITY_LINKED',
} as const;

export class TenantUserFacet {
    private static profileAssetCreatedAnchorEvent(profileAsset: any) {
        return Boolean(profileAsset?.[PROFILE_ASSET_ANCHOR_EVENT_CREATED]);
    }

    private static profileAssetWithAnchorEventState(profileAsset: any, lastAnchorEvent: any, anchorEventCreated: boolean) {
        const result = { ...profileAsset, lastAnchorEvent };
        Object.defineProperty(result, PROFILE_ASSET_ANCHOR_EVENT_CREATED, {
            value: anchorEventCreated,
            enumerable: false,
        });
        return result;
    }

    static async ensureTenantQuantum(client: any = prisma) {
        const slug = getPlatformTenantSlug();
        const current = await client.tenant.findUnique({ where: { slug } });
        const previous = current
            ? null
            : await client.tenant.findUnique({ where: { slug: PREVIOUS_PLATFORM_TENANT_SLUG } });

        if (previous) {
            return client.tenant.update({
                where: { id: previous.id },
                data: buildQuantumTenantData(previous.activatedAt),
            });
        }

        return client.tenant.upsert({
            where: { slug },
            create: {
                ...buildQuantumTenantData(new Date()),
                slug,
            },
            update: buildQuantumTenantData(),
        });
    }

    static async getCurrentUser(input: TenantUserLookupInput) {
        const tenant = await this.ensureTenantQuantum();
        return this.findTenantUser(prisma, tenant.id, input);
    }

    static async upsertB2CUser(input: TenantUserUpsertInput) {
        const tenant = input.tenantId
            ? await this.ensureTenantExists(input.tenantId)
            : await this.ensureTenantQuantum();

        const normalized = await this.normalizeUserInput(tenant.id, input);

        const result = await prisma.$transaction(async (tx) => {
            const existing = await this.findTenantUser(tx, tenant.id, {
                legacyDashboardUserId: normalized.legacyDashboardUserId,
                legacyOpenId: normalized.legacyOpenId,
                email: normalized.email,
                document: normalized.document,
            });
            await this.ensureDocumentAvailable(tx, normalized.document, existing?.id);

            const user = existing
                ? await tx.tenantUser.update({
                    where: { id: existing.id },
                    data: buildTenantUserUpdateData(normalized),
                    include: TENANT_USER_INCLUDE,
                })
                : await tx.tenantUser.create({
                    data: buildTenantUserCreateData(tenant.id, normalized),
                    include: TENANT_USER_INCLUDE,
                });

            const membershipRole = mapTenantUserRoleToMembershipRole(user.role);
            await tx.tenantMembership.upsert({
                where: {
                    tenantId_userId: {
                        tenantId: tenant.id,
                        userId: user.id,
                    },
                },
                create: {
                    tenantId: tenant.id,
                    userId: user.id,
                    role: membershipRole,
                    status: mapTenantUserStatusToMembershipStatus(user.status),
                    reason: `${input.source || 'tenant-user-upsert'} canonical user link`,
                },
                update: {
                    role: membershipRole,
                    status: mapTenantUserStatusToMembershipStatus(user.status),
                },
            });

            const profileAsset = await this.upsertTenantUserProfileAsset(tx, {
                tenantId: tenant.id,
                user,
                issuerId: input.legacyOpenId || input.email || user.id,
                reason: input.source || 'canonical B2C user upsert',
            });

            return { ...user, profileAsset };
        });

        if (this.profileAssetCreatedAnchorEvent(result.profileAsset)) {
            AnchorQueueService.processQueue({ tenantId: tenant.id }).catch(console.error);
        }
        return result;
    }

    static async listDependents(tenantUserId: string) {
        const user = await prisma.tenantUser.findUnique({
            where: { id: tenantUserId },
            select: { id: true, tenantId: true },
        });
        if (!user) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Tenant user not found.');
        }

        const dependents = await prisma.tenantUser.findMany({
            where: {
                tenantId: user.tenantId,
                guardianId: tenantUserId,
            },
            orderBy: { createdAt: 'desc' },
            include: TENANT_USER_INCLUDE,
        });

        return Promise.all(dependents.map(async (dependent) => ({
            ...dependent,
            profileAsset: await this.getTenantUserProfileAssetForUser(dependent),
        })));
    }

    static async createDependent(guardianTenantUserId: string, input: TenantUserUpsertInput) {
        const guardian = await prisma.tenantUser.findUnique({
            where: { id: guardianTenantUserId },
            select: { id: true, tenantId: true },
        });
        if (!guardian) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Guardian tenant user not found.');
        }

        return this.upsertB2CUser({
            ...input,
            tenantId: guardian.tenantId,
            guardianId: guardian.id,
            role: TenantUserRole.DEPENDENT,
            source: input.source || 'dependent-create',
        });
    }

    static async updateDependent(
        guardianTenantUserId: string,
        dependentId: string,
        input: TenantUserProfileUpdateInput
    ) {
        const guardian = await prisma.tenantUser.findUnique({
            where: { id: guardianTenantUserId },
            select: { id: true, tenantId: true },
        });
        if (!guardian) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Guardian tenant user not found.');
        }

        const dependent = await prisma.tenantUser.findFirst({
            where: {
                id: dependentId,
                tenantId: guardian.tenantId,
                guardianId: guardian.id,
            },
            select: { id: true },
        });
        if (!dependent) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Dependent tenant user not found for this guardian.');
        }

        return this.updateProfile(dependentId, input);
    }

    static async createDependentWithRegistrationCredit(
        guardianTenantUserId: string,
        input: TenantUserDependentWithCreditInput
    ) {
        const guardian = await prisma.tenantUser.findUnique({
            where: { id: guardianTenantUserId },
            select: { id: true, tenantId: true },
        });
        if (!guardian) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Guardian tenant user not found.');
        }

        const baseIdempotencyKey = input.idempotencyKey || buildDependentRegistrationIdempotencyKey(
            guardian.id,
            input
        );
        const referenceId = input.legacyOpenId || input.email || input.document || baseIdempotencyKey;
        const metadata = {
            guardianId: guardian.id,
            source: input.source || 'dependent-registration-credit',
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
        };

        await RegistrationCreditFacet.reserveForDependentRegistration({
            tenantId: guardian.tenantId,
            userId: guardian.id,
            idempotencyKey: `${baseIdempotencyKey}:reserve`,
            referenceId,
            reason: input.reason || 'dependent registration',
            metadata,
        });

        let dependent: Awaited<ReturnType<typeof this.upsertB2CUser>> | null = null;
        try {
            dependent = await this.upsertB2CUser({
                ...input,
                tenantId: guardian.tenantId,
                guardianId: guardian.id,
                role: TenantUserRole.DEPENDENT,
                source: input.source || 'dependent-registration-credit',
            });

            await RegistrationCreditFacet.consumeReservedForDependentRegistration({
                tenantId: guardian.tenantId,
                userId: guardian.id,
                idempotencyKey: `${baseIdempotencyKey}:consume`,
                referenceId: dependent.id,
                reason: input.reason || 'dependent registration',
                metadata,
            });
        } catch (error) {
            await RegistrationCreditFacet.releaseForDependentRegistration({
                tenantId: guardian.tenantId,
                userId: guardian.id,
                idempotencyKey: `${baseIdempotencyKey}:release`,
                referenceId,
                reason: input.reason || 'dependent registration failed',
                metadata,
            }).catch(() => undefined);

            if (dependent?.id) {
                await prisma.tenantUser.update({
                    where: { id: dependent.id },
                    data: {
                        status: TenantUserStatus.ARCHIVED,
                        metadata: {
                            ...normalizeJsonObject(dependent.metadata),
                            registrationCreditFailedAt: new Date().toISOString(),
                        },
                    },
                }).catch(() => undefined);
            }
            throw error;
        }

        const creditSummary = await RegistrationCreditFacet.getSummary(guardian.tenantId, guardian.id);
        return { dependent, creditSummary };
    }

    static async updateProfile(tenantUserId: string, input: TenantUserProfileUpdateInput) {
        const existing = await prisma.tenantUser.findUnique({ where: { id: tenantUserId } });
        if (!existing) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Tenant user not found.');
        }

        const normalized = await this.normalizeUserInput(existing.tenantId, {
            ...input,
            legacyDashboardUserId: existing.legacyDashboardUserId,
            legacyOpenId: existing.legacyOpenId,
            email: input.email !== undefined ? input.email : existing.email,
            phone: input.phone !== undefined ? input.phone : existing.phone,
            document: input.document !== undefined || input.cpf !== undefined
                ? input.document ?? input.cpf
                : existing.document,
            documentType: input.documentType !== undefined ? input.documentType : existing.documentType,
            displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
            role: existing.role,
            status: existing.status,
            guardianId: existing.guardianId,
            profile: input.profile !== undefined ? input.profile : normalizeJsonObject(existing.profile),
            metadata: input.metadata !== undefined
                ? mergeJsonObject(existing.metadata, input.metadata)
                : normalizeJsonObject(existing.metadata),
            migratedAt: existing.migratedAt,
        });

        const result = await prisma.$transaction(async (tx) => {
            await this.ensureDocumentAvailable(tx, normalized.document, tenantUserId);

            const user = await tx.tenantUser.update({
                where: { id: tenantUserId },
                data: buildTenantUserUpdateData(normalized),
                include: TENANT_USER_INCLUDE,
            });

            const profileAsset = await this.upsertTenantUserProfileAsset(tx, {
                tenantId: user.tenantId,
                user,
                issuerId: user.legacyOpenId || user.email || user.id,
                reason: input.reason || 'profile update',
            });

            return { ...user, profileAsset };
        });

        if (this.profileAssetCreatedAnchorEvent(result.profileAsset)) {
            AnchorQueueService.processQueue({ tenantId: existing.tenantId }).catch(console.error);
        }
        return result;
    }

    static async linkExternalIdentity(params: {
        tenantUserId: string;
        provider: string;
        providerSubject: string;
        email?: string | null;
        metadata?: JsonRecord;
        actor?: AdminActorContext;
        reason?: string;
        ipAddress?: string;
        userAgent?: string;
    }) {
        const provider = normalizeNullableString(params.provider);
        const providerSubject = normalizeNullableString(params.providerSubject);
        if (!provider || !providerSubject) {
            throw new TenantUserError('INVALID_EXTERNAL_IDENTITY', 'Provider and subject are required.');
        }

        return prisma.$transaction(async (tx) => {
            const user = await tx.tenantUser.findUnique({
                where: { id: params.tenantUserId },
                select: { id: true, tenantId: true },
            });
            if (!user) {
                throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Tenant user not found.');
            }

            const identity = await tx.externalIdentity.upsert({
                where: {
                    provider_providerSubject: {
                        provider,
                        providerSubject,
                    },
                },
                create: {
                    tenantUserId: user.id,
                    provider,
                    providerSubject,
                    email: normalizeEmail(params.email),
                    metadata: normalizeJsonObject(params.metadata),
                },
                update: {
                    tenantUserId: user.id,
                    email: normalizeEmail(params.email),
                    metadata: normalizeJsonObject(params.metadata),
                },
            });

            if (params.actor) {
                await this.createAdminAuditLog(tx, {
                    tenantId: user.tenantId,
                    actor: params.actor,
                    action: TENANT_USER_ACTIONS.TENANT_USER_EXTERNAL_IDENTITY_LINKED,
                    resourceId: user.id,
                    reason: AdminAuthorizationFacet.requireReason(params.reason || params.actor.reason),
                    payload: {
                        provider,
                        providerSubject,
                        identityId: identity.id,
                    },
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                });
            }

            return identity;
        });
    }

    static async listTenantUsers(
        actor: AdminActorContext,
        tenantId: string,
        params: TenantUserListParams = {}
    ) {
        this.ensurePlatformActor(actor);
        await this.ensureTenantExists(tenantId);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where = buildTenantUserWhere(tenantId, params);

        const [users, total] = await Promise.all([
            prisma.tenantUser.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    externalIdentities: true,
                    memberships: true,
                    _count: {
                        select: {
                            dependents: true,
                        },
                    },
                },
            }),
            prisma.tenantUser.count({ where }),
        ]);

        return {
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    static async getTenantUser(actor: AdminActorContext, tenantId: string, userId: string) {
        this.ensurePlatformActor(actor);

        const user = await prisma.tenantUser.findFirst({
            where: { id: userId, tenantId },
            include: TENANT_USER_INCLUDE,
        });

        if (!user) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Tenant user not found for this tenant.');
        }

        const [assets, profileAsset] = await Promise.all([
            this.listTenantUserAssets(actor, tenantId, userId),
            this.getTenantUserProfileAssetState(actor, tenantId, userId),
        ]);

        return { ...user, assets: assets.assets, profileAsset };
    }

    static async createTenantUser(
        actor: AdminActorContext,
        tenantId: string,
        input: TenantUserCreateInput
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(input.reason || actor.reason);

        const result = await this.upsertB2CUser({
            ...input,
            tenantId,
            source: 'platform-admin-create',
        });

        await prisma.adminAuditLog.create({
            data: buildAdminAuditData({
                tenantId,
                actor,
                action: TENANT_USER_ACTIONS.TENANT_USER_CREATED,
                resourceId: result.id,
                reason,
                payload: sanitizeTenantUserForAudit(result),
                ipAddress: input.ipAddress,
                userAgent: input.userAgent,
            }),
        });

        return result;
    }

    static async updateTenantUser(
        actor: AdminActorContext,
        tenantId: string,
        userId: string,
        input: TenantUserUpdateInput
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(input.reason || actor.reason);
        const current = await this.getTenantUser(actor, tenantId, userId);

        const normalized = await this.normalizeUserInput(tenantId, {
            ...input,
            legacyDashboardUserId: current.legacyDashboardUserId,
            legacyOpenId: current.legacyOpenId,
            email: input.email !== undefined ? input.email : current.email,
            phone: input.phone !== undefined ? input.phone : current.phone,
            document: input.document !== undefined || input.cpf !== undefined
                ? input.document ?? input.cpf
                : current.document,
            documentType: input.documentType !== undefined ? input.documentType : current.documentType,
            displayName: input.displayName !== undefined ? input.displayName : current.displayName,
            role: input.role || current.role,
            status: input.status || current.status,
            guardianId: current.guardianId,
            profile: input.profile !== undefined ? input.profile : normalizeJsonObject(current.profile),
            metadata: input.metadata !== undefined
                ? mergeJsonObject(current.metadata, input.metadata)
                : normalizeJsonObject(current.metadata),
            migratedAt: current.migratedAt,
        });

        const result = await prisma.$transaction(async (tx) => {
            await this.ensureDocumentAvailable(tx, normalized.document, userId);

            const user = await tx.tenantUser.update({
                where: { id: userId },
                data: buildTenantUserUpdateData(normalized),
                include: TENANT_USER_INCLUDE,
            });

            await tx.tenantMembership.upsert({
                where: {
                    tenantId_userId: {
                        tenantId,
                        userId,
                    },
                },
                create: {
                    tenantId,
                    userId,
                    role: mapTenantUserRoleToMembershipRole(user.role),
                    status: mapTenantUserStatusToMembershipStatus(user.status),
                    reason,
                    invitedByUserId: actor.actorUserId,
                },
                update: {
                    role: mapTenantUserRoleToMembershipRole(user.role),
                    status: mapTenantUserStatusToMembershipStatus(user.status),
                    reason,
                },
            });

            const profileAsset = await this.upsertTenantUserProfileAsset(tx, {
                tenantId,
                user,
                issuerId: actor.actorUserId,
                reason,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: TENANT_USER_ACTIONS.TENANT_USER_UPDATED,
                resourceId: user.id,
                reason,
                payload: sanitizeTenantUserForAudit(user),
                ipAddress: input.ipAddress,
                userAgent: input.userAgent,
            });

            return { ...user, profileAsset };
        });

        if (this.profileAssetCreatedAnchorEvent(result.profileAsset)) {
            AnchorQueueService.processQueue({ tenantId }).catch(console.error);
        }
        return result;
    }

    static async setTenantUserStatus(
        actor: AdminActorContext,
        tenantId: string,
        userId: string,
        status: TenantUserStatus,
        context: { reason?: string; ipAddress?: string; userAgent?: string } = {}
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(context.reason || actor.reason);
        await this.ensureTenantUserExists(tenantId, userId);

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.tenantUser.update({
                where: { id: userId },
                data: { status },
                include: TENANT_USER_INCLUDE,
            });

            await tx.tenantMembership.updateMany({
                where: { tenantId, userId },
                data: { status: mapTenantUserStatusToMembershipStatus(status), reason },
            });

            const profileAsset = await this.upsertTenantUserProfileAsset(tx, {
                tenantId,
                user,
                issuerId: actor.actorUserId,
                reason,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: TENANT_USER_ACTIONS.TENANT_USER_STATUS_CHANGED,
                resourceId: user.id,
                reason,
                payload: { status },
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });

            return { ...user, profileAsset };
        });

        if (this.profileAssetCreatedAnchorEvent(result.profileAsset)) {
            AnchorQueueService.processQueue({ tenantId }).catch(console.error);
        }
        return result;
    }

    static async assignTenantUserRole(
        actor: AdminActorContext,
        tenantId: string,
        userId: string,
        role: TenantUserRole,
        context: { reason?: string; ipAddress?: string; userAgent?: string } = {}
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(context.reason || actor.reason);
        await this.ensureTenantUserExists(tenantId, userId);

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.tenantUser.update({
                where: { id: userId },
                data: { role },
                include: TENANT_USER_INCLUDE,
            });

            await tx.tenantMembership.upsert({
                where: {
                    tenantId_userId: { tenantId, userId },
                },
                create: {
                    tenantId,
                    userId,
                    role: mapTenantUserRoleToMembershipRole(role),
                    status: mapTenantUserStatusToMembershipStatus(user.status),
                    reason,
                    invitedByUserId: actor.actorUserId,
                },
                update: {
                    role: mapTenantUserRoleToMembershipRole(role),
                    reason,
                },
            });

            const profileAsset = await this.upsertTenantUserProfileAsset(tx, {
                tenantId,
                user,
                issuerId: actor.actorUserId,
                reason,
            });

            await this.createAdminAuditLog(tx, {
                tenantId,
                actor,
                action: TENANT_USER_ACTIONS.TENANT_USER_ROLE_ASSIGNED,
                resourceId: user.id,
                reason,
                payload: { role },
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });

            return { ...user, profileAsset };
        });

        if (this.profileAssetCreatedAnchorEvent(result.profileAsset)) {
            AnchorQueueService.processQueue({ tenantId }).catch(console.error);
        }
        return result;
    }

    static async listTenantUserAssets(
        actor: AdminActorContext,
        tenantId: string,
        userId: string,
        params: { page?: number; limit?: number } = {}
    ) {
        this.ensurePlatformActor(actor);
        const user = await this.ensureTenantUserExists(tenantId, userId);
        const ownerRefs = buildOwnerRefCandidates(user);
        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where: Prisma.AssetWhereInput = {
            tenantId,
            owners: {
                some: {
                    revokedAt: null,
                    OR: [
                        { ownerRef: { in: ownerRefs } },
                        ...(user.document ? [{ document: user.document }] : []),
                    ],
                },
            },
        };

        const [assets, total] = await Promise.all([
            prisma.asset.findMany({
                where,
                skip,
                take: limit,
                orderBy: { updatedAt: 'desc' },
                include: {
                    owners: true,
                    events: { orderBy: { createdAt: 'desc' }, take: 5 },
                },
            }),
            prisma.asset.count({ where }),
        ]);

        return {
            ownerRefs,
            assets,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    static async getTenantUserProfileAssetState(
        actor: AdminActorContext,
        tenantId: string,
        userId: string
    ) {
        this.ensurePlatformActor(actor);
        const user = await this.ensureTenantUserExists(tenantId, userId);
        return this.getTenantUserProfileAssetForUser(user);
    }

    private static async getTenantUserProfileAssetForUser(user: any) {
        const profileAsset = await this.findTenantUserProfileAsset(prisma, user, {
            id: true,
            tenantId: true,
            externalId: true,
            publicUrl: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        });

        if (!profileAsset) return null;

        const lastAnchorEvent = await prisma.eventLog.findFirst({
            where: {
                tenantId: user.tenantId,
                assetId: profileAsset.id,
                origin: TENANT_USER_PROFILE_EVENT_ORIGIN,
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                status: true,
                dltTxId: true,
                signatureHash: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return { ...profileAsset, lastAnchorEvent };
    }

    private static async normalizeUserInput(
        tenantId: string,
        input: TenantUserNormalizeInput
    ) {
        const guardianId = await resolveGuardianId(tenantId, input);
        const document = normalizeDocument(input.document ?? input.cpf);
        const documentType = document ? (input.documentType || 'CPF').trim().toUpperCase() : normalizeNullableString(input.documentType);

        return {
            tenantId,
            legacyDashboardUserId: normalizeLegacyDashboardUserId(input.legacyDashboardUserId),
            legacyOpenId: normalizeNullableString(input.legacyOpenId),
            email: normalizeEmail(input.email),
            phone: normalizeNullableString(input.phone),
            document,
            documentType,
            displayName: normalizeNullableString(input.displayName),
            role: input.role || (guardianId ? TenantUserRole.DEPENDENT : TenantUserRole.MEMBER),
            status: input.status || TenantUserStatus.ACTIVE,
            guardianId,
            profile: normalizeJsonObject(input.profile),
            metadata: normalizeJsonObject(input.metadata),
            migratedAt: normalizeDate(input.migratedAt),
        };
    }

    private static async findTenantUser(client: any, tenantId: string, input: TenantUserLookupInput) {
        if (input.id) {
            const byId = await client.tenantUser.findFirst({
                where: { id: input.id, tenantId },
                include: TENANT_USER_INCLUDE,
            });
            if (byId) return byId;
        }

        const legacyDashboardUserId = normalizeLegacyDashboardUserId(input.legacyDashboardUserId);
        if (legacyDashboardUserId) {
            const byLegacyDashboardId = await client.tenantUser.findUnique({
                where: { legacyDashboardUserId },
                include: TENANT_USER_INCLUDE,
            });
            if (byLegacyDashboardId?.tenantId === tenantId) return byLegacyDashboardId;
        }

        const legacyOpenId = normalizeNullableString(input.legacyOpenId);
        if (legacyOpenId) {
            const byOpenId = await client.tenantUser.findUnique({
                where: { legacyOpenId },
                include: TENANT_USER_INCLUDE,
            });
            if (byOpenId?.tenantId === tenantId) return byOpenId;
        }

        const document = normalizeDocument(input.document ?? input.cpf);
        if (document) {
            const byDocument = await client.tenantUser.findFirst({
                where: { tenantId, document },
                include: TENANT_USER_INCLUDE,
            });
            if (byDocument) return byDocument;
        }

        const email = normalizeEmail(input.email);
        if (email) {
            return client.tenantUser.findFirst({
                where: { tenantId, email },
                include: TENANT_USER_INCLUDE,
            });
        }

        return null;
    }

    private static async ensureDocumentAvailable(client: any, document?: string | null, currentUserId?: string) {
        if (!document) return;

        const existing = await client.tenantUser.findFirst({
            where: {
                document,
                ...(currentUserId ? { id: { not: currentUserId } } : {}),
            },
            select: { id: true },
        });

        if (existing) {
            throw new TenantUserError('CPF_ALREADY_EXISTS', 'CPF já cadastrado para outro usuário.');
        }
    }

    private static async ensureTenantExists(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) {
            throw new TenantUserError('TENANT_NOT_FOUND', 'Tenant not found.');
        }
        return tenant;
    }

    private static async ensureTenantUserExists(tenantId: string, userId: string) {
        const user = await prisma.tenantUser.findFirst({
            where: { id: userId, tenantId },
        });
        if (!user) {
            throw new TenantUserError('TENANT_USER_NOT_FOUND', 'Tenant user not found for this tenant.');
        }
        return user;
    }

    private static ensurePlatformActor(actor?: AdminActorContext) {
        if (!actor?.actorUserId) {
            throw new TenantUserError('ADMIN_ACTOR_REQUIRED', 'Platform admin actor is required.');
        }

        if (actor.role !== TenantMembershipRole.PLATFORM_ADMIN) {
            throw new TenantUserError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }
    }

    private static async upsertTenantUserProfileAsset(
        tx: any,
        params: {
            tenantId: string;
            user: any;
            issuerId: string;
            reason: string;
        }
    ) {
        const existingProfileAsset = await this.findTenantUserProfileAsset(tx, params.user, {
            id: true,
            externalId: true,
        });
        const assetId = existingProfileAsset?.id ?? randomUUID();
        const externalId = buildTenantUserProfileExternalId(params.user);
        const upsertExternalId = existingProfileAsset?.externalId ?? externalId;
        const metadata = buildTenantUserProfileAssetMetadata(params.user);

        const profileAsset = await tx.asset.upsert({
            where: {
                tenantId_externalId: {
                    tenantId: params.tenantId,
                    externalId: upsertExternalId,
                },
            },
            create: {
                id: assetId,
                tenantId: params.tenantId,
                externalId,
                status: AssetStatus.ACTIVE,
                metadata,
                publicDataKeys: TENANT_USER_PUBLIC_DATA_KEYS,
                publicUrl: buildPublicVerifyUrl(assetId),
            },
            update: {
                externalId,
                status: AssetStatus.ACTIVE,
                metadata,
                publicDataKeys: TENANT_USER_PUBLIC_DATA_KEYS,
                publicUrl: buildPublicVerifyUrl(assetId),
            },
        });

        if (existingProfileAsset) {
            const lastAnchorEvent = await tx.eventLog.findFirst({
                where: {
                    assetId: profileAsset.id,
                    origin: TENANT_USER_PROFILE_EVENT_ORIGIN,
                },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    status: true,
                    dltTxId: true,
                    signatureHash: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            return this.profileAssetWithAnchorEventState(profileAsset, lastAnchorEvent, false);
        }

        const payload = buildTenantUserProfileEventPayload({
            user: params.user,
            profileAsset,
            reason: params.reason,
        });

        const lastAnchorEvent = await tx.eventLog.create({
            data: {
                assetId: profileAsset.id,
                tenantId: params.tenantId,
                origin: TENANT_USER_PROFILE_EVENT_ORIGIN,
                issuerId: params.issuerId,
                status: EventStatus.APPROVED,
                payload,
                signatureHash: AssetAnchoringService.signatureHash(payload),
                dltTxId: null,
            },
            select: {
                id: true,
                status: true,
                dltTxId: true,
                signatureHash: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return this.profileAssetWithAnchorEventState(profileAsset, lastAnchorEvent, true);
    }

    private static async findTenantUserProfileAsset(client: any, user: any, select: any) {
        for (const externalId of buildTenantUserProfileExternalIdCandidates(user)) {
            const asset = await client.asset.findUnique({
                where: {
                    tenantId_externalId: {
                        tenantId: user.tenantId,
                        externalId,
                    },
                },
                select,
            });
            if (asset) return asset;
        }

        return null;
    }

    private static async createAdminAuditLog(
        tx: any,
        params: {
            tenantId: string;
            actor: AdminActorContext;
            action: string;
            resourceId: string;
            reason: string;
            payload: JsonRecord;
            ipAddress?: string;
            userAgent?: string;
        }
    ) {
        await tx.adminAuditLog.create({
            data: buildAdminAuditData(params),
        });
    }
}

function buildQuantumTenantData(existingActivatedAt?: Date | null): Prisma.TenantUncheckedCreateInput & Prisma.TenantUncheckedUpdateInput {
    return {
        name: getPlatformTenantName(),
        slug: getPlatformTenantSlug(),
        contactEmail: getPlatformTenantContactEmail(),
        planTier: PlanTier.ENTERPRISE,
        targetChain: DEFAULT_TENANT_TARGET_CHAIN,
        isActive: true,
        status: TenantStatus.ACTIVE,
        activatedAt: existingActivatedAt ?? undefined,
        suspendedAt: null,
        archivedAt: null,
        statusReason: null,
    };
}

function buildTenantUserCreateData(tenantId: string, input: NormalizedTenantUserInput): Prisma.TenantUserUncheckedCreateInput {
    return {
        tenantId,
        email: input.email,
        phone: input.phone,
        document: input.document,
        documentType: input.documentType,
        displayName: input.displayName,
        role: input.role,
        status: input.status,
        legacyDashboardUserId: input.legacyDashboardUserId,
        legacyOpenId: input.legacyOpenId,
        profile: input.profile,
        metadata: input.metadata,
        guardianId: input.guardianId,
        migratedAt: input.migratedAt,
    };
}

function buildTenantUserUpdateData(input: NormalizedTenantUserInput): Prisma.TenantUserUncheckedUpdateInput {
    return {
        email: input.email,
        phone: input.phone,
        document: input.document,
        documentType: input.documentType,
        displayName: input.displayName,
        role: input.role,
        status: input.status,
        legacyDashboardUserId: input.legacyDashboardUserId,
        legacyOpenId: input.legacyOpenId,
        profile: input.profile,
        metadata: input.metadata,
        guardianId: input.guardianId,
        migratedAt: input.migratedAt ?? undefined,
    };
}

async function resolveGuardianId(tenantId: string, input: TenantUserNormalizeInput) {
    if (input.guardianId === null) return null;
    if (input.guardianId) return input.guardianId;

    const guardianLegacyDashboardUserId = normalizeLegacyDashboardUserId(input.guardianLegacyDashboardUserId);
    if (guardianLegacyDashboardUserId) {
        const guardian = await prisma.tenantUser.findUnique({
            where: { legacyDashboardUserId: guardianLegacyDashboardUserId },
            select: { id: true, tenantId: true },
        });
        if (guardian?.tenantId === tenantId) return guardian.id;
    }

    const guardianLegacyOpenId = normalizeNullableString(input.guardianLegacyOpenId);
    if (guardianLegacyOpenId) {
        const guardian = await prisma.tenantUser.findUnique({
            where: { legacyOpenId: guardianLegacyOpenId },
            select: { id: true, tenantId: true },
        });
        if (guardian?.tenantId === tenantId) return guardian.id;
    }

    return undefined;
}

function buildTenantUserWhere(tenantId: string, params: TenantUserListParams): Prisma.TenantUserWhereInput {
    const where: Prisma.TenantUserWhereInput = { tenantId };
    if (params.role) where.role = params.role;
    if (params.status) where.status = params.status;

    const search = params.search?.trim();
    if (search) {
        const document = normalizeDocument(search);
        where.OR = [
            { displayName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { legacyOpenId: { contains: search, mode: 'insensitive' } },
            { legacyDashboardUserId: { contains: search, mode: 'insensitive' } },
            ...(document ? [{ document: { contains: document } }] : []),
        ];
    }

    return where;
}

function buildTenantUserProfileExternalId(user: any): string {
    return `tenant-user-profile:${user.id}`;
}

function buildTenantUserProfileExternalIdCandidates(user: any): string[] {
    return [
        buildTenantUserProfileExternalId(user),
        user.legacyDashboardUserId ? `qc:user:${user.legacyDashboardUserId}` : null,
        user.legacyOpenId ? `identity:${user.legacyOpenId}` : null,
    ].filter(Boolean) as string[];
}

function buildTenantUserProfileAssetMetadata(user: any): Prisma.InputJsonObject {
    return {
        assetKind: TENANT_USER_PROFILE_ASSET_KIND,
        schemaVersion: 1,
        tenantUserId: user.id,
        profile: {
            displayName: user.displayName ?? null,
            email: user.email ?? null,
            phone: user.phone ?? null,
            role: user.role,
            status: user.status,
            guardianId: user.guardianId ?? null,
            legacyDashboardUserId: user.legacyDashboardUserId ?? null,
            legacyOpenId: user.legacyOpenId ?? null,
        },
        document: buildDocumentMetadata(user.document, user.documentType),
        profileData: normalizeJsonObject(user.profile),
        metadata: normalizeJsonObject(user.metadata),
    };
}

function buildTenantUserProfileEventPayload(params: {
    user: any;
    profileAsset: any;
    reason: string;
}): Prisma.InputJsonObject {
    return {
        eventType: 'TENANT_USER_PROFILE_CREATED',
        schemaVersion: 1,
        tenantUserId: params.user.id,
        profileAssetId: params.profileAsset.id,
        profileAssetExternalId: params.profileAsset.externalId,
        document: buildDocumentMetadata(params.user.document, params.user.documentType),
        profile: {
            displayName: params.user.displayName ?? null,
            email: params.user.email ?? null,
            phone: params.user.phone ?? null,
            role: params.user.role,
            status: params.user.status,
            guardianId: params.user.guardianId ?? null,
            legacyDashboardUserId: params.user.legacyDashboardUserId ?? null,
            legacyOpenId: params.user.legacyOpenId ?? null,
        },
        reason: params.reason,
        recordedAt: new Date().toISOString(),
    };
}

function buildDocumentMetadata(document?: string | null, documentType?: string | null): Prisma.InputJsonObject {
    if (!document) return {};

    return {
        documentType: documentType || 'CPF',
        documentValue: document,
        documentHash: createHash('sha256').update(document).digest('hex'),
        documentHashAlgorithm: 'SHA-256',
        documentNormalization: 'digits-only',
    };
}

function buildOwnerRefCandidates(user: any): string[] {
    return Array.from(new Set([
        user.id,
        user.legacyOpenId,
        user.legacyDashboardUserId ? `qc:user:${user.legacyDashboardUserId}` : null,
        user.legacyDashboardUserId,
        user.email,
        user.document,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function mapTenantUserRoleToMembershipRole(role: TenantUserRole): TenantMembershipRole {
    if (role === TenantUserRole.PLATFORM_ADMIN) return TenantMembershipRole.PLATFORM_ADMIN;
    if (role === TenantUserRole.TENANT_ADMIN) return TenantMembershipRole.TENANT_ADMIN;
    if (role === TenantUserRole.OPERATOR) return TenantMembershipRole.OPERATOR;
    if (role === TenantUserRole.VIEWER) return TenantMembershipRole.VIEWER;
    return TenantMembershipRole.MEMBER;
}

function mapTenantUserStatusToMembershipStatus(status: TenantUserStatus): TenantMembershipStatus {
    if (status === TenantUserStatus.INVITED) return TenantMembershipStatus.INVITED;
    if (status === TenantUserStatus.SUSPENDED) return TenantMembershipStatus.SUSPENDED;
    if (status === TenantUserStatus.ARCHIVED) return TenantMembershipStatus.REMOVED;
    return TenantMembershipStatus.ACTIVE;
}

function buildAdminAuditData(params: {
    tenantId: string;
    actor: AdminActorContext;
    action: string;
    resourceId: string;
    reason: string;
    payload: JsonRecord;
    ipAddress?: string;
    userAgent?: string;
}): Prisma.AdminAuditLogUncheckedCreateInput {
    const payloadHash = createHash('sha256').update(JSON.stringify(params.payload)).digest('hex');
    return {
        tenantId: params.tenantId,
        actorUserId: params.actor.actorUserId,
        actorTenantId: params.actor.actorTenantId,
        action: params.action,
        resourceType: ResourceTypes.TENANT_USER,
        resourceId: params.resourceId,
        reason: params.reason,
        payloadHash,
        correlationId: params.actor.correlationId,
        metadata: {
            ...params.payload,
            facet: DiamondFacets.TENANT_USER,
        },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
    };
}

function sanitizeTenantUserForAudit(user: any): JsonRecord {
    return {
        id: user.id,
        tenantId: user.tenantId,
        legacyDashboardUserId: user.legacyDashboardUserId ?? null,
        legacyOpenId: user.legacyOpenId ?? null,
        email: user.email ?? null,
        documentHash: user.document ? createHash('sha256').update(user.document).digest('hex') : null,
        documentType: user.documentType ?? null,
        role: user.role,
        status: user.status,
        guardianId: user.guardianId ?? null,
    };
}

function normalizeLegacyDashboardUserId(value?: string | number | null): string | null {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

function normalizeDocument(value?: string | null): string | null {
    if (!value) return null;
    const normalized = value.replace(/\D/g, '');
    return normalized || null;
}

function normalizeEmail(value?: string | null): string | null {
    const normalized = normalizeNullableString(value)?.toLowerCase();
    return normalized ?? null;
}

function normalizeNullableString(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    return normalized || null;
}

function normalizeJsonObject(value: unknown): Prisma.InputJsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Prisma.InputJsonObject;
}

function mergeJsonObject(base: unknown, patch: unknown): Prisma.InputJsonObject {
    return {
        ...normalizeJsonObject(base),
        ...normalizeJsonObject(patch),
    };
}

function buildDependentRegistrationIdempotencyKey(
    guardianId: string,
    input: TenantUserDependentWithCreditInput
) {
    return createHash('sha256')
        .update(JSON.stringify({
            guardianId,
            email: input.email ?? null,
            document: input.document ?? input.cpf ?? null,
            displayName: input.displayName ?? null,
            legacyOpenId: input.legacyOpenId ?? null,
        }))
        .digest('hex');
}

function normalizeDate(value?: Date | string | null): Date | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizePage(value?: number): number {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizeLimit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(Math.floor(value), 100);
}

export class TenantUserError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'TenantUserError';
    }
}
