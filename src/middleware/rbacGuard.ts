// ═══════════════════════════════════════════════════════════
// MIDDLEWARE: RBAC Guard
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Enforces role-based access control on routes.
// Must be used AFTER apiKeyAuth middleware (requires req.apiKeyRole).
//
// Role Hierarchy: ADMIN > OPERATOR > READER
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import { ApiKeyRole } from '@prisma/client';
import { AuthenticatedRequest, hasPermission } from '../types';

// ─── REQUIRE ROLE ───────────────────────────────────────
// Factory function that creates a middleware requiring a minimum RBAC role.
//
// Usage:
//   router.post('/tenants', requireApiKey, requireRole('ADMIN'), handler);
//   router.get('/assets', requireApiKey, requireRole('READER'), handler);
//   router.post('/assets', requireApiKey, requireRole('OPERATOR'), handler);
export const requireRole = (minimumRole: ApiKeyRole) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.apiKeyRole) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required. No API key context found.',
            });
        }

        if (!hasPermission(req.apiKeyRole, minimumRole)) {
            return res.status(403).json({
                success: false,
                error: `Insufficient permissions. Required role: ${minimumRole}, your role: ${req.apiKeyRole}.`,
                code: 'INSUFFICIENT_PERMISSIONS',
            });
        }

        next();
    };
};

// ─── REQUIRE ADMIN ──────────────────────────────────────
// Shorthand for requireRole('ADMIN')
export const requireAdmin = requireRole('ADMIN' as ApiKeyRole);

// ─── REQUIRE OPERATOR ───────────────────────────────────
// Shorthand for requireRole('OPERATOR'). Allows ADMIN and OPERATOR.
export const requireOperator = requireRole('OPERATOR' as ApiKeyRole);

// ─── REQUIRE READER ─────────────────────────────────────
// Shorthand for requireRole('READER'). Allows all authenticated roles.
export const requireReader = requireRole('READER' as ApiKeyRole);
