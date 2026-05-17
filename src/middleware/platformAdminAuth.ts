import { NextFunction, Response } from 'express';
import {
    AdminAuthorizationError,
    AdminAuthorizationFacet,
} from '../services/core-facets/AdminAuthorizationFacet';
import { AuthenticatedRequest } from '../types';

export const requirePlatformAdmin = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const reason = getReason(req);
        const correlationId = getHeader(req, 'x-correlation-id') || getHeader(req, 'x-request-id');

        req.adminActor = await AdminAuthorizationFacet.requirePlatformAdmin({
            actorUserId: getHeader(req, 'x-admin-user-id'),
            actorTenantId: getHeader(req, 'x-admin-tenant-id'),
            reason,
            correlationId,
        });
        req.adminScope = 'PLATFORM';
        req.correlationId = correlationId;

        next();
    } catch (error) {
        respondWithAdminError(error, res);
    }
};

export const requireTenantAdmin = (tenantIdResolver?: (req: AuthenticatedRequest) => string | undefined) => {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const targetTenantId = tenantIdResolver?.(req)
                || req.params.tenantId
                || req.tenantId
                || getHeader(req, 'x-admin-tenant-id');
            const reason = getReason(req);
            const correlationId = getHeader(req, 'x-correlation-id') || getHeader(req, 'x-request-id');

            req.adminActor = await AdminAuthorizationFacet.requireTenantAdmin({
                actorUserId: getHeader(req, 'x-admin-user-id'),
                targetTenantId,
                reason,
                correlationId,
            });
            req.adminScope = 'TENANT';
            req.correlationId = correlationId;

            next();
        } catch (error) {
            respondWithAdminError(error, res);
        }
    };
};

export const requireAdminReason = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        AdminAuthorizationFacet.requireReason(getReason(req));
        next();
    } catch (error) {
        respondWithAdminError(error, res);
    }
};

function getReason(req: AuthenticatedRequest): string | undefined {
    const bodyReason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const headerReason = getHeader(req, 'x-admin-reason');
    return bodyReason || headerReason;
}

function getHeader(req: AuthenticatedRequest, name: string): string | undefined {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
}

function respondWithAdminError(error: unknown, res: Response) {
    if (error instanceof AdminAuthorizationError) {
        const statusMap: Record<string, number> = {
            ADMIN_REASON_REQUIRED: 400,
            ADMIN_ACTOR_REQUIRED: 401,
            ADMIN_ACTOR_NOT_FOUND: 401,
            TENANT_SCOPE_REQUIRED: 400,
            PLATFORM_ADMIN_REQUIRED: 403,
            TENANT_ADMIN_REQUIRED: 403,
        };

        return res.status(statusMap[error.code] || 403).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }

    return res.status(500).json({
        success: false,
        error: 'Internal admin authorization error.',
    });
}
