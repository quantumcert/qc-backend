import prisma from '../../config/prisma';
import {
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantUserStatus,
} from '@prisma/client';
import { AdminActorContext } from '../../types';
import { getPlatformTenantSlug } from '../../config/platformTenant';

type MembershipWithTenant = {
    tenantId: string;
    role: TenantMembershipRole;
    status: TenantMembershipStatus;
    tenant?: { id: string; slug: string };
};

type TenantUserWithMemberships = {
    id: string;
    tenantId: string;
    status: TenantUserStatus;
    memberships: MembershipWithTenant[];
};

export class AdminAuthorizationFacet {
    static async resolveAdminActor(params: {
        actorUserId?: string;
        actorTenantId?: string;
        reason?: string;
        correlationId?: string;
    }): Promise<TenantUserWithMemberships> {
        const { actorUserId } = params;

        if (!actorUserId) {
            throw new AdminAuthorizationError('ADMIN_ACTOR_REQUIRED', 'Admin actor is required.');
        }

        const actorInclude = {
            memberships: {
                include: {
                    tenant: {
                        select: { id: true, slug: true },
                    },
                },
            },
        };

        const actor = await prisma.tenantUser.findUnique({
            where: { id: actorUserId },
            include: actorInclude,
        }) as TenantUserWithMemberships | null
            || await prisma.tenantUser.findUnique({
                where: { legacyOpenId: actorUserId },
                include: actorInclude,
            }) as TenantUserWithMemberships | null;

        if (!actor || actor.status !== TenantUserStatus.ACTIVE) {
            throw new AdminAuthorizationError('ADMIN_ACTOR_NOT_FOUND', 'Active admin actor not found.');
        }

        return actor;
    }

    static async requirePlatformAdmin(params: {
        actorUserId?: string;
        actorTenantId?: string;
        reason?: string;
        correlationId?: string;
        platformTenantSlug?: string;
    }): Promise<AdminActorContext> {
        const actor = await this.resolveAdminActor(params);
        const platformTenantSlug = params.platformTenantSlug || getPlatformTenantSlug();

        const membership = actor.memberships.find((item) =>
            item.status === TenantMembershipStatus.ACTIVE
            && item.role === TenantMembershipRole.PLATFORM_ADMIN
            && (!item.tenant || item.tenant.slug === platformTenantSlug)
        );

        if (!membership) {
            throw new AdminAuthorizationError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }

        return {
            actorUserId: actor.id,
            actorTenantId: membership.tenantId,
            role: membership.role,
            reason: params.reason,
            correlationId: params.correlationId,
        };
    }

    static async requireTenantAdmin(params: {
        actorUserId?: string;
        targetTenantId?: string;
        reason?: string;
        correlationId?: string;
    }): Promise<AdminActorContext> {
        const actor = await this.resolveAdminActor(params);

        if (!params.targetTenantId) {
            throw new AdminAuthorizationError('TENANT_SCOPE_REQUIRED', 'Tenant scope is required.');
        }

        const membership = actor.memberships.find((item) =>
            item.status === TenantMembershipStatus.ACTIVE
            && item.tenantId === params.targetTenantId
            && (
                item.role === TenantMembershipRole.TENANT_ADMIN
                || item.role === TenantMembershipRole.PLATFORM_ADMIN
            )
        );

        if (!membership) {
            throw new AdminAuthorizationError('TENANT_ADMIN_REQUIRED', 'Tenant Admin permission is required for this tenant.');
        }

        return {
            actorUserId: actor.id,
            actorTenantId: membership.tenantId,
            tenantId: params.targetTenantId,
            role: membership.role,
            reason: params.reason,
            correlationId: params.correlationId,
        };
    }

    static requireReason(reason?: string): string {
        const normalized = reason?.trim();
        if (!normalized) {
            throw new AdminAuthorizationError('ADMIN_REASON_REQUIRED', 'A reason is required for privileged admin mutations.');
        }
        return normalized;
    }

    static buildAuditContext(params: AdminActorContext & {
        tenantId?: string;
        reason?: string;
        payloadHash?: string;
    }) {
        return {
            actorUserId: params.actorUserId,
            actorTenantId: params.actorTenantId,
            tenantId: params.tenantId,
            reason: params.reason,
            correlationId: params.correlationId,
            payloadHash: params.payloadHash,
        };
    }
}

export class AdminAuthorizationError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminAuthorizationError';
    }
}
