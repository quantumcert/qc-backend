// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: ApiKeyManagementFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Responsibility: Generate, validate, rotate, and revoke API Keys.
// Each key is bound to a Tenant with an RBAC role (ADMIN/OPERATOR/READER).
//
// Security Model:
//   - Raw keys are NEVER stored. Only SHA-256 hashes are persisted.
//   - Key format: qc_{env}_{32 random hex chars}
//   - The raw key is returned ONCE at creation time.
//
// Agnostic facet - no domain terms.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/prisma';
import { ApiKeyRole } from '@prisma/client';
import { AuditActions, ResourceTypes, DiamondFacets } from '../../types';

export class ApiKeyManagementFacet {

    // ─── GENERATE API KEY ─────────────────────────────────
    // Creates a new API key for a tenant with the specified RBAC role.
    // Returns the raw key ONLY ONCE — it cannot be recovered later.
    static async generateApiKey(params: {
        tenantId: string;
        role: ApiKeyRole;
        label?: string;
        expiresAt?: Date;
        ipAddress?: string;
        userAgent?: string;
    }) {
        const { tenantId, role, label, expiresAt, ipAddress, userAgent } = params;

        // Verify tenant exists and is active
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
        });

        if (!tenant) {
            throw new ApiKeyError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }

        if (!tenant.isActive) {
            throw new ApiKeyError('TENANT_INACTIVE', `Cannot generate API key for inactive tenant.`);
        }

        // Generate cryptographically secure key
        const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
        const rawKey = `qc_${env}_${crypto.randomBytes(32).toString('hex')}`;
        // RED TEAM HOTFIX 5: Anti-Rainbow Tables (bcrypt instead of plain SHA-256)
        const keyHash = await bcrypt.hash(rawKey, 10);
        const keyPrefix = rawKey.substring(0, 16); // "qc_test_a1b2c3d4" or "qc_live_a1b2c3d4"

        // Transactional creation: ApiKey + Audit Log
        const apiKey = await prisma.$transaction(async (tx) => {
            const newKey = await tx.apiKey.create({
                data: {
                    tenantId,
                    keyHash,
                    keyPrefix,
                    label,
                    role,
                    expiresAt,
                },
            });

            // Audit trail
            await tx.auditLog.create({
                data: {
                    tenantId,
                    apiKeyPrefix: keyPrefix,
                    action: AuditActions.APIKEY_GENERATED,
                    resourceType: ResourceTypes.API_KEY,
                    resourceId: newKey.id,
                    metadata: {
                        role,
                        label,
                        hasExpiration: !!expiresAt,
                        facet: DiamondFacets.API_KEY_MANAGEMENT,
                    },
                    ipAddress,
                    userAgent,
                },
            });

            return newKey;
        });

        // Return the raw key ONCE — this is the only time it's available
        return {
            id: apiKey.id,
            rawKey,           // ⚠️ ONLY TIME THIS IS RETURNED
            keyPrefix,
            role: apiKey.role,
            label: apiKey.label,
            tenantId: apiKey.tenantId,
            expiresAt: apiKey.expiresAt,
            createdAt: apiKey.createdAt,
        };
    }

    // ─── VALIDATE API KEY ─────────────────────────────────
    // Resolves a raw API key to its tenant context and RBAC role.
    // Used by the auth middleware on every authenticated request.
    static async validateApiKey(rawKey: string) {
        // RED TEAM HOTFIX 5: Anti-Rainbow Tables
        const keyPrefix = rawKey.substring(0, 16);

        const apiKeys = await prisma.apiKey.findMany({
            where: { keyPrefix },
            include: {
                tenant: {
                    select: {
                        id: true,
                        slug: true,
                        isActive: true,
                        planTier: true,
                        maxRequestsPerMinute: true,
                        maxRequestsPerDay: true,
                    },
                },
            },
        });

        let apiKey = null;
        for (const key of apiKeys) {
            if (await bcrypt.compare(rawKey, key.keyHash)) {
                apiKey = key;
                break;
            }
        }

        if (!apiKey) {
            throw new ApiKeyError('INVALID_KEY', 'Invalid API key.');
        }

        if (!apiKey.isActive) {
            throw new ApiKeyError('KEY_REVOKED', 'This API key has been revoked.');
        }

        if (apiKey.revokedAt) {
            throw new ApiKeyError('KEY_REVOKED', 'This API key has been revoked.');
        }

        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
            throw new ApiKeyError('KEY_EXPIRED', 'This API key has expired.');
        }

        if (!apiKey.tenant.isActive) {
            throw new ApiKeyError('TENANT_INACTIVE', 'The tenant associated with this key is inactive.');
        }

        // Update lastUsedAt (non-blocking — fire-and-forget)
        prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        }).catch(() => { /* Silently fail — non-critical */ });

        return {
            apiKeyId: apiKey.id,
            apiKeyPrefix: apiKey.keyPrefix,
            role: apiKey.role,
            tenant: apiKey.tenant,
        };
    }

    // ─── REVOKE API KEY ───────────────────────────────────
    // Permanently deactivates an API key.
    static async revokeApiKey(params: {
        apiKeyId: string;
        tenantId: string; // Ensures tenant isolation
        ipAddress?: string;
        userAgent?: string;
        apiKeyPrefix?: string;
    }) {
        const { apiKeyId, tenantId, ipAddress, userAgent, apiKeyPrefix } = params;

        // Verify key belongs to the tenant (isolation check)
        const existingKey = await prisma.apiKey.findFirst({
            where: {
                id: apiKeyId,
                tenantId,
            },
        });

        if (!existingKey) {
            throw new ApiKeyError('KEY_NOT_FOUND', 'API key not found for this tenant.');
        }

        if (!existingKey.isActive) {
            throw new ApiKeyError('KEY_ALREADY_REVOKED', 'This API key is already revoked.');
        }

        const result = await prisma.$transaction(async (tx) => {
            const revoked = await tx.apiKey.update({
                where: { id: apiKeyId },
                data: {
                    isActive: false,
                    revokedAt: new Date(),
                },
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    apiKeyPrefix: apiKeyPrefix || existingKey.keyPrefix,
                    action: AuditActions.APIKEY_REVOKED,
                    resourceType: ResourceTypes.API_KEY,
                    resourceId: apiKeyId,
                    metadata: {
                        revokedKeyPrefix: existingKey.keyPrefix,
                        revokedRole: existingKey.role,
                        facet: DiamondFacets.API_KEY_MANAGEMENT,
                    },
                    ipAddress,
                    userAgent,
                },
            });

            return revoked;
        });

        return {
            id: result.id,
            keyPrefix: result.keyPrefix,
            role: result.role,
            revokedAt: result.revokedAt,
        };
    }

    // ─── ROTATE API KEY ───────────────────────────────────
    // Revokes the old key and generates a new one with the same role/config.
    static async rotateApiKey(params: {
        apiKeyId: string;
        tenantId: string;
        ipAddress?: string;
        userAgent?: string;
        apiKeyPrefix?: string;
    }) {
        const { apiKeyId, tenantId, ipAddress, userAgent, apiKeyPrefix } = params;

        // Get the existing key to copy its configuration
        const existingKey = await prisma.apiKey.findFirst({
            where: {
                id: apiKeyId,
                tenantId,
                isActive: true,
            },
        });

        if (!existingKey) {
            throw new ApiKeyError('KEY_NOT_FOUND', 'Active API key not found for this tenant.');
        }

        // Generate new key material
        const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
        const rawKey = `qc_${env}_${crypto.randomBytes(32).toString('hex')}`;
        // RED TEAM HOTFIX 5: Anti-Rainbow Tables
        const keyHash = await bcrypt.hash(rawKey, 10);
        const newKeyPrefix = rawKey.substring(0, 16);

        const result = await prisma.$transaction(async (tx) => {
            // Revoke old key
            await tx.apiKey.update({
                where: { id: apiKeyId },
                data: {
                    isActive: false,
                    revokedAt: new Date(),
                },
            });

            // Create new key with same configuration
            const newKey = await tx.apiKey.create({
                data: {
                    tenantId,
                    keyHash,
                    keyPrefix: newKeyPrefix,
                    label: existingKey.label,
                    role: existingKey.role,
                    expiresAt: existingKey.expiresAt,
                },
            });

            // Audit trail
            await tx.auditLog.create({
                data: {
                    tenantId,
                    apiKeyPrefix: apiKeyPrefix || existingKey.keyPrefix,
                    action: AuditActions.APIKEY_ROTATED,
                    resourceType: ResourceTypes.API_KEY,
                    resourceId: newKey.id,
                    metadata: {
                        previousKeyId: apiKeyId,
                        previousKeyPrefix: existingKey.keyPrefix,
                        newKeyPrefix,
                        role: existingKey.role,
                        facet: DiamondFacets.API_KEY_MANAGEMENT,
                    },
                    ipAddress,
                    userAgent,
                },
            });

            return newKey;
        });

        return {
            id: result.id,
            rawKey,           // ⚠️ ONLY TIME THIS IS RETURNED
            keyPrefix: newKeyPrefix,
            role: result.role,
            label: result.label,
            tenantId: result.tenantId,
            previousKeyId: apiKeyId,
            createdAt: result.createdAt,
        };
    }

    // ─── LIST API KEYS (for a Tenant) ─────────────────────
    // Returns all keys for a tenant (without hashes).
    static async listApiKeys(tenantId: string, includeRevoked = false, page = 1, limit = 20) {
        const where: any = { tenantId };
        if (!includeRevoked) {
            where.isActive = true;
        }

        // RED TEAM HOTFIX 8: Anti-OOM Pagination Lock
        const safeLimit = limit > 50 ? 50 : limit;
        const skip = (page - 1) * safeLimit;

        const keys = await prisma.apiKey.findMany({
            where,
            skip,
            take: safeLimit,
            select: {
                id: true,
                keyPrefix: true,
                label: true,
                role: true,
                isActive: true,
                revokedAt: true,
                lastUsedAt: true,
                expiresAt: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return keys;
    }
}

// ─── API KEY ERROR ──────────────────────────────────────
export class ApiKeyError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'ApiKeyError';
    }
}
