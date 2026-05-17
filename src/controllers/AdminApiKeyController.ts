import { Response } from 'express';
import { z } from 'zod';
import { ApiKeyRole } from '@prisma/client';
import {
    AdminApiKeyOperationsError,
    AdminApiKeyOperationsFacet,
} from '../services/core-facets/AdminApiKeyOperationsFacet';
import { AdminAuthorizationError } from '../services/core-facets/AdminAuthorizationFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

const booleanQuerySchema = z.preprocess((value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}, z.boolean().optional());

const dateSchema = z.string().datetime().optional().transform((value) =>
    value ? new Date(value) : undefined
);

const listApiKeysSchema = z.object({
    includeRevoked: booleanQuerySchema,
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createInitialApiKeySchema = z.object({
    label: z.string().trim().min(1).max(100),
    role: z.nativeEnum(ApiKeyRole).optional(),
    scopes: z.array(z.string().trim().min(1)).max(50).optional(),
    expiresAt: dateSchema,
    reason: z.string().trim().min(1),
});

const rotateApiKeySchema = z.object({
    label: z.string().trim().min(1).max(100).optional(),
    expiresAt: dateSchema,
    reason: z.string().trim().min(1),
});

const revokeApiKeySchema = z.object({
    reason: z.string().trim().min(1),
});

export class AdminApiKeyController {
    static async list(req: AuthenticatedRequest, res: Response) {
        try {
            const query = listApiKeysSchema.parse(req.query);
            const result = await AdminApiKeyOperationsFacet.listTenantApiKeys(
                req.adminActor!,
                req.params.tenantId,
                query
            );

            return res.json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminApiKeyError(error, res, '[AdminApiKeyController.list]');
        }
    }

    static async createInitial(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = createInitialApiKeySchema.parse(req.body);
            const result = await AdminApiKeyOperationsFacet.createInitialApiKey(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminApiKeyError(error, res, '[AdminApiKeyController.createInitial]');
        }
    }

    static async rotate(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = rotateApiKeySchema.parse(req.body);
            const result = await AdminApiKeyOperationsFacet.rotateApiKey(
                req.adminActor!,
                req.params.tenantId,
                req.params.apiKeyId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminApiKeyError(error, res, '[AdminApiKeyController.rotate]');
        }
    }

    static async revoke(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = revokeApiKeySchema.parse(req.body);
            const result = await AdminApiKeyOperationsFacet.revokeApiKey(
                req.adminActor!,
                req.params.tenantId,
                req.params.apiKeyId,
                {
                    ...payload,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAdminApiKeyError(error, res, '[AdminApiKeyController.revoke]');
        }
    }
}

function buildMeta() {
    return {
        timestamp: new Date().toISOString(),
        facet: DiamondFacets.ADMIN_API_KEY_OPERATIONS,
    };
}

function respondWithAdminApiKeyError(error: unknown, res: Response, logPrefix: string) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: error.errors,
        });
    }

    if (error instanceof AdminApiKeyOperationsError || error instanceof AdminAuthorizationError) {
        const statusMap: Record<string, number> = {
            ADMIN_ACTOR_REQUIRED: 401,
            ADMIN_REASON_REQUIRED: 400,
            INVALID_LABEL: 400,
            PLATFORM_ADMIN_REQUIRED: 403,
            TENANT_NOT_FOUND: 404,
            TENANT_NOT_ACTIVE: 409,
            INITIAL_KEY_ALREADY_EXISTS: 409,
            KEY_NOT_FOUND: 404,
            KEY_ALREADY_REVOKED: 409,
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
