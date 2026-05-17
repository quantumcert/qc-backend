// ═══════════════════════════════════════════════════════════
// MIDDLEWARE: API Key Authentication
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Extracts the API key from the X-API-Key header, validates it
// via ApiKeyManagementFacet, and injects tenant context into
// the request object for downstream handlers.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ApiKeyManagementFacet, ApiKeyError } from '../services/core-facets/ApiKeyManagementFacet';
import { AuthenticatedRequest } from '../types';

// ─── REQUIRE API KEY ────────────────────────────────────
// Mandatory authentication. Returns 401 if no valid key is provided.
export const requireApiKey = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const rawKey = extractApiKey(req);

        if (!rawKey) {
            return res.status(401).json({
                success: false,
                error: 'Missing API key. Provide via X-API-Key header.',
            });
        }

        const result = await ApiKeyManagementFacet.validateApiKey(rawKey);

        // Inject tenant context into the request
        req.tenantId = result.tenant.id;
        req.apiKeyId = result.apiKeyId;
        req.apiKeyRole = result.role;
        req.apiKeyPrefix = result.apiKeyPrefix;
        req.correlationId = getCorrelationId(req);

        next();
    } catch (error) {
        if (error instanceof ApiKeyError) {
            const statusMap: Record<string, number> = {
                INVALID_KEY: 401,
                KEY_REVOKED: 401,
                KEY_EXPIRED: 401,
                TENANT_INACTIVE: 403,
            };
            const status = statusMap[error.code] || 401;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }

        console.error('[ApiKeyAuth] Unexpected error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal authentication error.',
        });
    }
};

// ─── OPTIONAL API KEY ───────────────────────────────────
// Attempts authentication but allows unauthenticated requests to pass.
// Used for routes that serve both public and authenticated origins.
export const optionalApiKey = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const rawKey = extractApiKey(req);

        if (rawKey) {
            const result = await ApiKeyManagementFacet.validateApiKey(rawKey);
            req.tenantId = result.tenant.id;
            req.apiKeyId = result.apiKeyId;
            req.apiKeyRole = result.role;
            req.apiKeyPrefix = result.apiKeyPrefix;
            req.correlationId = getCorrelationId(req);
        }

        next();
    } catch (error) {
        // Authentication failed but this is optional — proceed without context
        next();
    }
};

// ─── EXTRACT API KEY ────────────────────────────────────
// Extracts the raw API key from the request.
// Supports: X-API-Key header (primary), Authorization: Bearer (fallback)
function extractApiKey(req: AuthenticatedRequest): string | null {
    // Primary: X-API-Key header
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.startsWith('qc_')) {
        return xApiKey;
    }

    // Fallback: Authorization: Bearer qc_...
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer qc_')) {
        return authHeader.substring(7);
    }

    return null;
}

function getCorrelationId(req: AuthenticatedRequest): string {
    return getHeader(req, 'x-correlation-id')
        || getHeader(req, 'x-request-id')
        || crypto.randomUUID();
}

function getHeader(req: AuthenticatedRequest, name: string): string | undefined {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
}
