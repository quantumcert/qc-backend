import { Response } from 'express';
import { z } from 'zod';
import { TenantUserRole, TenantUserStatus } from '@prisma/client';
import {
    TenantUserError,
    TenantUserFacet,
} from '../services/core-facets/TenantUserFacet';
import { AdminAuthorizationError } from '../services/core-facets/AdminAuthorizationFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

const jsonObjectSchema = z.record(z.unknown());

const tenantUserListSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().min(1).optional(),
    role: z.nativeEnum(TenantUserRole).optional(),
    status: z.nativeEnum(TenantUserStatus).optional(),
});

const tenantUserUpsertSchema = z.object({
    tenantId: z.string().trim().min(1).optional(),
    legacyDashboardUserId: z.union([z.string(), z.number()]).nullable().optional(),
    legacyOpenId: z.string().trim().min(1).nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    cpf: z.string().trim().min(1).nullable().optional(),
    document: z.string().trim().min(1).nullable().optional(),
    documentType: z.string().trim().min(1).nullable().optional(),
    displayName: z.string().trim().min(1).nullable().optional(),
    role: z.nativeEnum(TenantUserRole).optional(),
    status: z.nativeEnum(TenantUserStatus).optional(),
    guardianId: z.string().trim().min(1).nullable().optional(),
    guardianLegacyDashboardUserId: z.union([z.string(), z.number()]).nullable().optional(),
    guardianLegacyOpenId: z.string().trim().min(1).nullable().optional(),
    profile: jsonObjectSchema.nullable().optional(),
    metadata: jsonObjectSchema.nullable().optional(),
    source: z.string().trim().min(1).optional(),
});

const tenantUserProfileSchema = z.object({
    displayName: z.string().trim().min(1).nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    cpf: z.string().trim().min(1).nullable().optional(),
    document: z.string().trim().min(1).nullable().optional(),
    documentType: z.string().trim().min(1).nullable().optional(),
    profile: jsonObjectSchema.nullable().optional(),
    metadata: jsonObjectSchema.nullable().optional(),
    reason: z.string().trim().min(1).optional(),
});

const tenantUserAdminCreateSchema = tenantUserUpsertSchema.extend({
    reason: z.string().trim().min(1),
});

const tenantUserAdminUpdateSchema = tenantUserProfileSchema.extend({
    role: z.nativeEnum(TenantUserRole).optional(),
    status: z.nativeEnum(TenantUserStatus).optional(),
    reason: z.string().trim().min(1),
});

const statusSchema = z.object({
    status: z.nativeEnum(TenantUserStatus),
    reason: z.string().trim().min(1),
});

const roleSchema = z.object({
    role: z.nativeEnum(TenantUserRole),
    reason: z.string().trim().min(1),
});

const externalIdentitySchema = z.object({
    provider: z.string().trim().min(1),
    providerSubject: z.string().trim().min(1),
    email: z.string().email().nullable().optional(),
    metadata: jsonObjectSchema.optional(),
    reason: z.string().trim().min(1).optional(),
});

const currentUserSchema = z.object({
    id: z.string().trim().min(1).optional(),
    legacyDashboardUserId: z.union([z.string(), z.number()]).nullable().optional(),
    legacyOpenId: z.string().trim().min(1).nullable().optional(),
    email: z.string().email().nullable().optional(),
    cpf: z.string().trim().min(1).nullable().optional(),
    document: z.string().trim().min(1).nullable().optional(),
});

export class TenantUserController {
    static async ensureQuantum(_req: AuthenticatedRequest, res: Response) {
        try {
            const tenant = await TenantUserFacet.ensureTenantQuantum();
            return res.json({ success: true, data: tenant, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.ensureQuantum]');
        }
    }

    static async current(req: AuthenticatedRequest, res: Response) {
        try {
            const query = currentUserSchema.parse({ ...req.query, ...req.body });
            const user = await TenantUserFacet.getCurrentUser(query);
            return res.json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.current]');
        }
    }

    static async upsertB2C(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = tenantUserUpsertSchema.parse(req.body);
            const user = await TenantUserFacet.upsertB2CUser(payload);
            return res.status(201).json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.upsertB2C]');
        }
    }

    static async updateProfile(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = tenantUserProfileSchema.parse(req.body);
            const user = await TenantUserFacet.updateProfile(req.params.userId, payload);
            return res.json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.updateProfile]');
        }
    }

    static async listDependents(req: AuthenticatedRequest, res: Response) {
        try {
            const dependents = await TenantUserFacet.listDependents(req.params.userId);
            return res.json({ success: true, data: dependents, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.listDependents]');
        }
    }

    static async createDependent(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = tenantUserUpsertSchema.parse(req.body);
            const dependent = await TenantUserFacet.createDependent(req.params.userId, payload);
            return res.status(201).json({ success: true, data: dependent, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.createDependent]');
        }
    }

    static async updateDependent(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = tenantUserProfileSchema.parse(req.body);
            const dependent = await TenantUserFacet.updateProfile(req.params.dependentId, payload);
            return res.json({ success: true, data: dependent, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.updateDependent]');
        }
    }

    static async linkExternalIdentity(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = externalIdentitySchema.parse(req.body);
            const identity = await TenantUserFacet.linkExternalIdentity({
                tenantUserId: req.params.userId,
                ...payload,
            });
            return res.status(201).json({ success: true, data: identity, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.linkExternalIdentity]');
        }
    }

    static async adminList(req: AuthenticatedRequest, res: Response) {
        try {
            const query = tenantUserListSchema.parse(req.query);
            const result = await TenantUserFacet.listTenantUsers(
                req.adminActor!,
                req.params.tenantId,
                query
            );
            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminList]');
        }
    }

    static async adminGet(req: AuthenticatedRequest, res: Response) {
        try {
            const user = await TenantUserFacet.getTenantUser(
                req.adminActor!,
                req.params.tenantId,
                req.params.userId
            );
            return res.json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminGet]');
        }
    }

    static async adminCreate(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = tenantUserAdminCreateSchema.parse(req.body);
            const user = await TenantUserFacet.createTenantUser(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );
            return res.status(201).json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminCreate]');
        }
    }

    static async adminUpdate(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = tenantUserAdminUpdateSchema.parse(req.body);
            const user = await TenantUserFacet.updateTenantUser(
                req.adminActor!,
                req.params.tenantId,
                req.params.userId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );
            return res.json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminUpdate]');
        }
    }

    static async adminStatus(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = statusSchema.parse(req.body);
            const user = await TenantUserFacet.setTenantUserStatus(
                req.adminActor!,
                req.params.tenantId,
                req.params.userId,
                payload.status,
                {
                    reason: payload.reason,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );
            return res.json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminStatus]');
        }
    }

    static async adminRole(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = roleSchema.parse(req.body);
            const user = await TenantUserFacet.assignTenantUserRole(
                req.adminActor!,
                req.params.tenantId,
                req.params.userId,
                payload.role,
                {
                    reason: payload.reason,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );
            return res.json({ success: true, data: user, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminRole]');
        }
    }

    static async adminAssets(req: AuthenticatedRequest, res: Response) {
        try {
            const query = z.object({
                page: z.coerce.number().int().min(1).optional(),
                limit: z.coerce.number().int().min(1).max(100).optional(),
            }).parse(req.query);
            const result = await TenantUserFacet.listTenantUserAssets(
                req.adminActor!,
                req.params.tenantId,
                req.params.userId,
                query
            );
            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminAssets]');
        }
    }

    static async adminProfileAsset(req: AuthenticatedRequest, res: Response) {
        try {
            const result = await TenantUserFacet.getTenantUserProfileAssetState(
                req.adminActor!,
                req.params.tenantId,
                req.params.userId
            );
            return res.json({ success: true, data: result, meta: buildMeta() });
        } catch (error) {
            return respondWithTenantUserError(error, res, '[TenantUserController.adminProfileAsset]');
        }
    }
}

function buildMeta() {
    return {
        timestamp: new Date().toISOString(),
        facet: DiamondFacets.TENANT_USER,
    };
}

function respondWithTenantUserError(error: unknown, res: Response, logPrefix: string) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: error.errors,
        });
    }

    if (error instanceof TenantUserError || error instanceof AdminAuthorizationError) {
        const statusMap: Record<string, number> = {
            ADMIN_ACTOR_REQUIRED: 401,
            ADMIN_REASON_REQUIRED: 400,
            PLATFORM_ADMIN_REQUIRED: 403,
            TENANT_NOT_FOUND: 404,
            TENANT_USER_NOT_FOUND: 404,
            INVALID_EXTERNAL_IDENTITY: 400,
            CPF_ALREADY_EXISTS: 409,
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
