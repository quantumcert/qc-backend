// ═══════════════════════════════════════════════════════════
// MIDDLEWARE: Error Handler
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Centralized error handling for the entire API.
// Converts known errors to proper HTTP responses.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { TenantError } from '../services/core-facets/TenantManagementFacet';
import { ApiKeyError } from '../services/core-facets/ApiKeyManagementFacet';

// ─── GLOBAL ERROR HANDLER ───────────────────────────────
export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    console.error(`[ErrorHandler] ${err.name}: ${err.message}`);

    // Zod Validation Errors
    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: err.errors.map((e) => ({
                path: e.path.join('.'),
                message: e.message,
            })),
        });
    }

    // Tenant Errors
    if (err instanceof TenantError) {
        const statusMap: Record<string, number> = {
            SLUG_ALREADY_EXISTS: 409,
            TENANT_NOT_FOUND: 404,
        };
        return res.status(statusMap[err.code] || 400).json({
            success: false,
            error: err.message,
            code: err.code,
        });
    }

    // API Key Errors
    if (err instanceof ApiKeyError) {
        const statusMap: Record<string, number> = {
            TENANT_NOT_FOUND: 404,
            TENANT_INACTIVE: 403,
            INVALID_KEY: 401,
            KEY_REVOKED: 401,
            KEY_EXPIRED: 401,
            KEY_NOT_FOUND: 404,
            KEY_ALREADY_REVOKED: 409,
        };
        return res.status(statusMap[err.code] || 400).json({
            success: false,
            error: err.message,
            code: err.code,
        });
    }

    // Prisma Unique Constraint Violation
    if (err.name === 'PrismaClientKnownRequestError' && (err as any).code === 'P2002') {
        return res.status(409).json({
            success: false,
            error: 'A resource with the same unique identifier already exists.',
            code: 'DUPLICATE_RESOURCE',
        });
    }

    // Generic 500
    return res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error.'
            : err.message,
    });
};

// ─── NOT FOUND HANDLER ──────────────────────────────────
export const notFoundHandler = (
    req: Request,
    res: Response
) => {
    return res.status(404).json({
        success: false,
        error: `Route ${req.method} ${req.path} not found.`,
    });
};
