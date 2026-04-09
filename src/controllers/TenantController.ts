// ═══════════════════════════════════════════════════════════
// CONTROLLER: Tenant Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// REST endpoints for Tenant CRUD operations.
// All operations require ADMIN-level API key authentication.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { z } from 'zod';
import { PlanTier } from '@prisma/client';
import { TenantManagementFacet, TenantError } from '../services/core-facets/TenantManagementFacet';
import { RateLimiterFacet } from '../services/core-facets/RateLimiterFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

// ─── VALIDATION SCHEMAS ─────────────────────────────────
const createTenantSchema = z.object({
    name: z.string().min(2).max(100),
    slug: z.string()
        .min(3)
        .max(50)
        .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens.'),
    contactEmail: z.string().email(),
    planTier: z.nativeEnum(PlanTier).optional(),
    maxRequestsPerMinute: z.number().int().positive().optional(),
    maxRequestsPerDay: z.number().int().positive().optional(),
});

const updateTenantSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    contactEmail: z.string().email().optional(),
    planTier: z.nativeEnum(PlanTier).optional(),
    maxRequestsPerMinute: z.number().int().positive().nullable().optional(),
    maxRequestsPerDay: z.number().int().positive().nullable().optional(),
});

const listTenantsSchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    planTier: z.nativeEnum(PlanTier).optional(),
    isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export class TenantController {

    // ─── POST /tenants ────────────────────────────────────
    static async create(req: AuthenticatedRequest, res: Response) {
        try {
            const data = createTenantSchema.parse(req.body);

            const tenant = await TenantManagementFacet.createTenant({
                ...data,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            });

            return res.status(201).json({
                success: true,
                data: tenant,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.TENANT_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation error.',
                    details: error.errors,
                });
            }
            if (error instanceof TenantError) {
                const status = error.code === 'SLUG_ALREADY_EXISTS' ? 409 : 400;
                return res.status(status).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[TenantController.create]', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error.',
            });
        }
    }

    // ─── GET /tenants ─────────────────────────────────────
    static async list(req: AuthenticatedRequest, res: Response) {
        try {
            const query = listTenantsSchema.parse(req.query);
            const result = await TenantManagementFacet.listTenants(query);

            return res.json({
                success: true,
                data: result.tenants,
                pagination: result.pagination,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.TENANT_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation error.',
                    details: error.errors,
                });
            }
            console.error('[TenantController.list]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── GET /tenants/:id ─────────────────────────────────
    static async getById(req: AuthenticatedRequest, res: Response) {
        try {
            const tenant = await TenantManagementFacet.getTenantById(req.params.id);

            return res.json({
                success: true,
                data: tenant,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.TENANT_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof TenantError && error.code === 'TENANT_NOT_FOUND') {
                return res.status(404).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[TenantController.getById]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── PATCH /tenants/:id ───────────────────────────────
    static async update(req: AuthenticatedRequest, res: Response) {
        try {
            const data = updateTenantSchema.parse(req.body);

            const tenant = await TenantManagementFacet.updateTenant(
                req.params.id,
                data,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    apiKeyPrefix: req.apiKeyPrefix,
                }
            );

            return res.json({
                success: true,
                data: tenant,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.TENANT_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation error.',
                    details: error.errors,
                });
            }
            if (error instanceof TenantError) {
                const status = error.code === 'TENANT_NOT_FOUND' ? 404 : 400;
                return res.status(status).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[TenantController.update]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── POST /tenants/:id/deactivate ─────────────────────
    static async deactivate(req: AuthenticatedRequest, res: Response) {
        try {
            const result = await TenantManagementFacet.deactivateTenant(
                req.params.id,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    apiKeyPrefix: req.apiKeyPrefix,
                }
            );

            return res.json({
                success: true,
                data: result,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.TENANT_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof TenantError && error.code === 'TENANT_NOT_FOUND') {
                return res.status(404).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[TenantController.deactivate]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── POST /tenants/:id/reactivate ─────────────────────
    static async reactivate(req: AuthenticatedRequest, res: Response) {
        try {
            const tenant = await TenantManagementFacet.reactivateTenant(
                req.params.id,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    apiKeyPrefix: req.apiKeyPrefix,
                }
            );

            return res.json({
                success: true,
                data: tenant,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.TENANT_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof TenantError && error.code === 'TENANT_NOT_FOUND') {
                return res.status(404).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[TenantController.reactivate]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── GET /tenants/:id/usage ───────────────────────────
    // Returns real-time rate limit consumption stats for the tenant.
    static async getUsage(req: AuthenticatedRequest, res: Response) {
        try {
            const tenant = await TenantManagementFacet.getTenantById(req.params.id);
            const usage = await RateLimiterFacet.getUsageStats(tenant.id, tenant.planTier);

            return res.json({
                success: true,
                data: {
                    tenant: {
                        id: tenant.id,
                        name: tenant.name,
                        planTier: tenant.planTier,
                    },
                    usage,
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.RATE_LIMITER,
                },
            });
        } catch (error) {
            if (error instanceof TenantError && error.code === 'TENANT_NOT_FOUND') {
                return res.status(404).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[TenantController.getUsage]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }
}
