import { Response } from 'express';
import { z } from 'zod';
import { PlanTier, TenantStatus } from '@prisma/client';
import {
    AdminTenantError,
    AdminTenantOperationsFacet,
} from '../services/core-facets/AdminTenantOperationsFacet';
import { AdminAuthorizationError } from '../services/core-facets/AdminAuthorizationFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

const jsonObjectSchema = z.record(z.unknown());

const commercialProfileSchema = z.object({
    legalName: z.string().trim().min(1).nullable().optional(),
    taxId: z.string().trim().min(1).nullable().optional(),
    taxIdType: z.string().trim().min(1).nullable().optional(),
    contactName: z.string().trim().min(1).nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().trim().min(1).nullable().optional(),
    billingOwner: z.string().trim().min(1).nullable().optional(),
    commercialPlan: z.string().trim().min(1).nullable().optional(),
    limits: jsonObjectSchema.optional(),
    whiteLabel: jsonObjectSchema.optional(),
    internalNotes: z.string().trim().nullable().optional(),
}).default({});

const listTenantsSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.nativeEnum(TenantStatus).optional(),
    planTier: z.nativeEnum(PlanTier).optional(),
    search: z.string().trim().min(1).optional(),
});

const createTenantSchema = z.object({
    name: z.string().trim().min(2),
    slug: z.string().trim().min(2),
    contactEmail: z.string().email(),
    planTier: z.nativeEnum(PlanTier).optional(),
    maxRequestsPerMinute: z.number().int().positive().nullable().optional(),
    maxRequestsPerDay: z.number().int().positive().nullable().optional(),
    commercialProfile: commercialProfileSchema,
    reason: z.string().trim().min(1),
});

const updateCommercialProfileSchema = z.object({
    name: z.string().trim().min(2).optional(),
    contactEmail: z.string().email().optional(),
    planTier: z.nativeEnum(PlanTier).optional(),
    maxRequestsPerMinute: z.number().int().positive().nullable().optional(),
    maxRequestsPerDay: z.number().int().positive().nullable().optional(),
    commercialProfile: commercialProfileSchema,
    reason: z.string().trim().min(1),
});

const lifecycleSchema = z.object({
    reason: z.string().trim().min(1),
});

export class AdminTenantController {
    static async list(req: AuthenticatedRequest, res: Response) {
        try {
            const query = listTenantsSchema.parse(req.query);
            const result = await AdminTenantOperationsFacet.listTenants(req.adminActor!, query);

            return res.json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.list]');
        }
    }

    static async get(req: AuthenticatedRequest, res: Response) {
        try {
            const tenant = await AdminTenantOperationsFacet.getTenant(
                req.adminActor!,
                req.params.tenantId
            );

            return res.json({
                success: true,
                data: tenant,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.get]');
        }
    }

    static async create(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = createTenantSchema.parse(req.body);
            const tenant = await AdminTenantOperationsFacet.createTenant(req.adminActor!, {
                ...payload,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            });

            return res.status(201).json({
                success: true,
                data: tenant,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.create]');
        }
    }

    static async updateCommercialProfile(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = updateCommercialProfileSchema.parse(req.body);
            const tenant = await AdminTenantOperationsFacet.updateCommercialProfile(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.json({
                success: true,
                data: tenant,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.updateCommercialProfile]');
        }
    }

    static async submitForReview(req: AuthenticatedRequest, res: Response) {
        try {
            const { reason } = lifecycleSchema.parse(req.body);
            const tenant = await AdminTenantOperationsFacet.submitForReview(
                req.adminActor!,
                req.params.tenantId,
                lifecycleContext(req, reason)
            );

            return res.json({ success: true, data: tenant, meta: buildMeta() });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.submitForReview]');
        }
    }

    static async activate(req: AuthenticatedRequest, res: Response) {
        try {
            const { reason } = lifecycleSchema.parse(req.body);
            const tenant = await AdminTenantOperationsFacet.activateTenant(
                req.adminActor!,
                req.params.tenantId,
                lifecycleContext(req, reason)
            );

            return res.json({ success: true, data: tenant, meta: buildMeta() });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.activate]');
        }
    }

    static async suspend(req: AuthenticatedRequest, res: Response) {
        try {
            const { reason } = lifecycleSchema.parse(req.body);
            const tenant = await AdminTenantOperationsFacet.suspendTenant(
                req.adminActor!,
                req.params.tenantId,
                lifecycleContext(req, reason)
            );

            return res.json({ success: true, data: tenant, meta: buildMeta() });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.suspend]');
        }
    }

    static async archive(req: AuthenticatedRequest, res: Response) {
        try {
            const { reason } = lifecycleSchema.parse(req.body);
            const tenant = await AdminTenantOperationsFacet.archiveTenant(
                req.adminActor!,
                req.params.tenantId,
                lifecycleContext(req, reason)
            );

            return res.json({ success: true, data: tenant, meta: buildMeta() });
        } catch (error) {
            return respondWithAdminTenantError(error, res, '[AdminTenantController.archive]');
        }
    }
}

function lifecycleContext(req: AuthenticatedRequest, reason: string) {
    return {
        reason,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    };
}

function buildMeta() {
    return {
        timestamp: new Date().toISOString(),
        facet: DiamondFacets.ADMIN_TENANT_OPERATIONS,
    };
}

function respondWithAdminTenantError(error: unknown, res: Response, logPrefix: string) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: error.errors,
        });
    }

    if (error instanceof AdminTenantError || error instanceof AdminAuthorizationError) {
        const statusMap: Record<string, number> = {
            ADMIN_ACTOR_REQUIRED: 401,
            ADMIN_REASON_REQUIRED: 400,
            INVALID_SLUG: 400,
            PLATFORM_ADMIN_REQUIRED: 403,
            SLUG_ALREADY_EXISTS: 409,
            TENANT_NOT_FOUND: 404,
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
