// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: TenantManagementFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Responsibility: CRUD operations for Tenant entities.
// Enforces SaaS isolation by scoping all operations to tenantId.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import prisma from '../../config/prisma';
import { PlanTier, Prisma } from '@prisma/client';
import { AuditActions, ResourceTypes, DiamondFacets } from '../../types';

export class TenantManagementFacet {

    // ─── CREATE TENANT ────────────────────────────────────
    // Registers a new isolated client organization.
    static async createTenant(params: {
        name: string;
        slug: string;
        contactEmail: string;
        planTier?: PlanTier;
        maxRequestsPerMinute?: number;
        maxRequestsPerDay?: number;
        ipAddress?: string;
        userAgent?: string;
    }) {
        const {
            name,
            slug,
            contactEmail,
            planTier = PlanTier.FREE,
            maxRequestsPerMinute,
            maxRequestsPerDay,
            ipAddress,
            userAgent,
        } = params;

        // Validate slug uniqueness
        const existingTenant = await prisma.tenant.findUnique({
            where: { slug },
        });

        if (existingTenant) {
            throw new TenantError('SLUG_ALREADY_EXISTS', `Tenant slug "${slug}" is already in use.`);
        }

        // Transactional creation: Tenant + Audit Log
        const tenant = await prisma.$transaction(async (tx) => {
            const newTenant = await tx.tenant.create({
                data: {
                    name,
                    slug,
                    contactEmail,
                    planTier,
                    maxRequestsPerMinute,
                    maxRequestsPerDay,
                },
            });

            // Audit trail
            await tx.auditLog.create({
                data: {
                    tenantId: newTenant.id,
                    action: AuditActions.TENANT_CREATED,
                    resourceType: ResourceTypes.TENANT,
                    resourceId: newTenant.id,
                    metadata: {
                        planTier,
                        facet: DiamondFacets.TENANT_MANAGEMENT,
                    },
                    ipAddress,
                    userAgent,
                },
            });

            return newTenant;
        });

        return tenant;
    }

    // ─── GET TENANT BY ID ─────────────────────────────────
    static async getTenantById(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            include: {
                _count: {
                    select: {
                        apiKeys: { where: { isActive: true } },
                    },
                },
            },
        });

        if (!tenant) {
            throw new TenantError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }

        return tenant;
    }

    // ─── GET TENANT BY SLUG ───────────────────────────────
    static async getTenantBySlug(slug: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { slug },
        });

        if (!tenant) {
            throw new TenantError('TENANT_NOT_FOUND', `Tenant with slug "${slug}" not found.`);
        }

        return tenant;
    }

    // ─── LIST TENANTS ─────────────────────────────────────
    // Admin-only operation. Supports pagination and filtering.
    static async listTenants(params: {
        page?: number;
        limit?: number;
        planTier?: PlanTier;
        isActive?: boolean;
    } = {}) {
        const { page = 1, limit = 20, planTier, isActive } = params;
        const skip = (page - 1) * limit;

        const where: Prisma.TenantWhereInput = {};
        if (planTier !== undefined) where.planTier = planTier;
        if (isActive !== undefined) where.isActive = isActive;

        const [tenants, total] = await Promise.all([
            prisma.tenant.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: {
                        select: {
                            apiKeys: { where: { isActive: true } },
                        },
                    },
                },
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

    // ─── UPDATE TENANT ────────────────────────────────────
    static async updateTenant(
        tenantId: string,
        data: {
            name?: string;
            contactEmail?: string;
            planTier?: PlanTier;
            maxRequestsPerMinute?: number | null;
            maxRequestsPerDay?: number | null;
        },
        auditContext?: { ipAddress?: string; userAgent?: string; apiKeyPrefix?: string }
    ) {
        // Ensure tenant exists
        await this.getTenantById(tenantId);

        const updated = await prisma.$transaction(async (tx) => {
            const updatedTenant = await tx.tenant.update({
                where: { id: tenantId },
                data,
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    apiKeyPrefix: auditContext?.apiKeyPrefix,
                    action: AuditActions.TENANT_UPDATED,
                    resourceType: ResourceTypes.TENANT,
                    resourceId: tenantId,
                    metadata: {
                        updatedFields: Object.keys(data),
                        facet: DiamondFacets.TENANT_MANAGEMENT,
                    },
                    ipAddress: auditContext?.ipAddress,
                    userAgent: auditContext?.userAgent,
                },
            });

            return updatedTenant;
        });

        return updated;
    }

    // ─── DEACTIVATE TENANT ────────────────────────────────
    // Soft-delete: sets isActive=false and revokes all API keys.
    static async deactivateTenant(
        tenantId: string,
        auditContext?: { ipAddress?: string; userAgent?: string; apiKeyPrefix?: string }
    ) {
        await this.getTenantById(tenantId);

        const result = await prisma.$transaction(async (tx) => {
            // Deactivate tenant
            const tenant = await tx.tenant.update({
                where: { id: tenantId },
                data: { isActive: false },
            });

            // Revoke all active API keys for this tenant
            const revokedKeys = await tx.apiKey.updateMany({
                where: { tenantId, isActive: true },
                data: {
                    isActive: false,
                    revokedAt: new Date(),
                },
            });

            // Audit trail
            await tx.auditLog.create({
                data: {
                    tenantId,
                    apiKeyPrefix: auditContext?.apiKeyPrefix,
                    action: AuditActions.TENANT_DEACTIVATED,
                    resourceType: ResourceTypes.TENANT,
                    resourceId: tenantId,
                    metadata: {
                        revokedApiKeys: revokedKeys.count,
                        facet: DiamondFacets.TENANT_MANAGEMENT,
                    },
                    ipAddress: auditContext?.ipAddress,
                    userAgent: auditContext?.userAgent,
                },
            });

            return { tenant, revokedApiKeys: revokedKeys.count };
        });

        return result;
    }

    // ─── REACTIVATE TENANT ────────────────────────────────
    static async reactivateTenant(
        tenantId: string,
        auditContext?: { ipAddress?: string; userAgent?: string; apiKeyPrefix?: string }
    ) {
        const tenant = await prisma.$transaction(async (tx) => {
            const updated = await tx.tenant.update({
                where: { id: tenantId },
                data: { isActive: true },
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    apiKeyPrefix: auditContext?.apiKeyPrefix,
                    action: AuditActions.TENANT_REACTIVATED,
                    resourceType: ResourceTypes.TENANT,
                    resourceId: tenantId,
                    metadata: { facet: DiamondFacets.TENANT_MANAGEMENT },
                    ipAddress: auditContext?.ipAddress,
                    userAgent: auditContext?.userAgent,
                },
            });

            return updated;
        });

        return tenant;
    }
}

// ─── TENANT ERROR ───────────────────────────────────────
export class TenantError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'TenantError';
    }
}
