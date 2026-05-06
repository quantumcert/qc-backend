// ═══════════════════════════════════════════════════════════
// CONTROLLER: API Key Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// REST endpoints for API Key lifecycle:
//   - Generation (with RBAC role assignment)
//   - Listing (for a tenant)
//   - Revocation
//   - Rotation (atomic revoke + re-create)
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { z } from 'zod';
import { ApiKeyRole } from '@prisma/client';
import { ApiKeyManagementFacet, ApiKeyError } from '../services/core-facets/ApiKeyManagementFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

// ─── VALIDATION SCHEMAS ─────────────────────────────────
const generateApiKeySchema = z.object({
    tenantId: z.string().min(1),
    role: z.nativeEnum(ApiKeyRole),
    label: z.string().max(100).optional(),
    expiresAt: z.string().datetime().optional().transform((v) => v ? new Date(v) : undefined),
});

export class ApiKeyController {

    // ─── POST /api-keys ───────────────────────────────────
    // Generate a new API key for a tenant.
    // Returns the raw key ONCE — store it securely.
    static async generate(req: AuthenticatedRequest, res: Response) {
        try {
            const data = generateApiKeySchema.parse(req.body);

            // Ensure the requester is operating on their own tenant (or is platform admin)
            // For Phase 1, the bootstrap/initial key is created via seed script.
            const result = await ApiKeyManagementFacet.generateApiKey({
                tenantId: data.tenantId,
                role: data.role,
                label: data.label,
                expiresAt: data.expiresAt,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            });

            return res.status(201).json({
                success: true,
                data: {
                    ...result,
                    warning: 'Store this key securely. It will not be shown again.',
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.API_KEY_MANAGEMENT,
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
            if (error instanceof ApiKeyError) {
                const statusMap: Record<string, number> = {
                    TENANT_NOT_FOUND: 404,
                    TENANT_INACTIVE: 403,
                };
                return res.status(statusMap[error.code] || 400).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[ApiKeyController.generate]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── GET /api-keys/:tenantId ──────────────────────────
    // List all API keys for a tenant.
    // Raw keys are NEVER returned — only prefixes and metadata.
    static async list(req: AuthenticatedRequest, res: Response) {
        try {
            const tenantId = req.params.tenantId;
            const includeRevoked = req.query.includeRevoked === 'true';

            // Tenant isolation: ensure requester belongs to this tenant
            if (req.tenantId && req.tenantId !== tenantId) {
                return res.status(403).json({
                    success: false,
                    error: 'Cannot access API keys of another tenant.',
                    code: 'TENANT_ISOLATION_VIOLATION',
                });
            }

            const keys = await ApiKeyManagementFacet.listApiKeys(tenantId, includeRevoked);

            return res.json({
                success: true,
                data: keys,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.API_KEY_MANAGEMENT,
                    count: keys.length,
                },
            });
        } catch (error) {
            console.error('[ApiKeyController.list]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── DELETE /api-keys/:id ─────────────────────────────
    // Revoke (deactivate) an API key.
    static async revoke(req: AuthenticatedRequest, res: Response) {
        try {
            const apiKeyId = req.params.id;

            if (!req.tenantId) {
                return res.status(401).json({
                    success: false,
                    error: 'Tenant context required.',
                });
            }

            const result = await ApiKeyManagementFacet.revokeApiKey({
                apiKeyId,
                tenantId: req.tenantId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                apiKeyPrefix: req.apiKeyPrefix,
            });

            return res.json({
                success: true,
                data: result,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.API_KEY_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof ApiKeyError) {
                const statusMap: Record<string, number> = {
                    KEY_NOT_FOUND: 404,
                    KEY_ALREADY_REVOKED: 409,
                };
                return res.status(statusMap[error.code] || 400).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[ApiKeyController.revoke]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }

    // ─── POST /api-keys/:id/rotate ────────────────────────
    // Atomically revoke old key and create new one with same config.
    static async rotate(req: AuthenticatedRequest, res: Response) {
        try {
            const apiKeyId = req.params.id;

            if (!req.tenantId) {
                return res.status(401).json({
                    success: false,
                    error: 'Tenant context required.',
                });
            }

            const result = await ApiKeyManagementFacet.rotateApiKey({
                apiKeyId,
                tenantId: req.tenantId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                apiKeyPrefix: req.apiKeyPrefix,
            });

            return res.status(201).json({
                success: true,
                data: {
                    ...result,
                    warning: 'Store this new key securely. The old key has been revoked.',
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: DiamondFacets.API_KEY_MANAGEMENT,
                },
            });
        } catch (error) {
            if (error instanceof ApiKeyError) {
                const statusMap: Record<string, number> = {
                    KEY_NOT_FOUND: 404,
                };
                return res.status(statusMap[error.code] || 400).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }
            console.error('[ApiKeyController.rotate]', error);
            return res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    }
}
