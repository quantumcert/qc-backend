// ═══════════════════════════════════════════════════════════
// AGNOSTIC ASSET REGISTRY FACET
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Agnostic Asset Engine
//
// handles CRUD operations for the universal Asset container.
// All metadata is treated as an opaque JSON blob.
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import prisma from '../../config/prisma';
import { AuditActions, ResourceTypes } from '../../types';
import { AnchorQueueService } from '../AnchorQueueService';
import { AssetAnchoringService } from '../AssetAnchoringService';

type AddOwnerPayload = {
    assetId?: string;
    id?: string;
    ownerRef: string;
    label?: string;
    sharePercent?: number;
};

type AddOwnerContext = {
    tenantId: string;
    apiKeyId?: string;
    role?: string;
};

function hashPrivateRef(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export class AssetRegistryFacet {
    /**
     * Create a new agnostic Asset.
     */
    static async createAsset(secureContext: any, payload: any) {
        // Minimum role: OPERATOR (mirrors requireOperator on the route)
        if (!['ADMIN', 'OPERATOR'].includes(secureContext.role)) throw new Error('Forbidden: Insufficient privileges');

        const tenantId = secureContext.tenantId;
        const { externalId, deviceId, metadata, publicDataKeys, owners, ...flags } = payload;

        const asset = await prisma.$transaction(async (tx) => {
            // Generate a secure UUID for the Asset to build the public URL synchronously
            const { v4: uuidv4 } = require('uuid');
            const id = uuidv4();
            const baseUrl = process.env.PUBLIC_URL_BASE || 'https://api.domain.com';
            const publicUrl = `${baseUrl}/v1/public/asset/${id}`;

            const asset = await tx.asset.create({
                data: {
                    id,
                    tenantId,
                    externalId,
                    deviceId,
                    metadata: metadata || {},
                    publicDataKeys: publicDataKeys || [],
                    publicUrl,
                    ...flags,
                    owners: owners ? {
                        create: owners.map((o: any) => ({
                            ownerRef: o.ownerRef,
                            label: o.label,
                            sharePercent: o.sharePercent
                        }))
                    } : undefined
                },
                include: {
                    owners: true,
                    device: true
                }
            });

            // Audit Log
            await tx.auditLog.create({
                data: {
                    tenantId,
                    action: AuditActions.ASSET_CREATED,
                    resourceType: ResourceTypes.ASSET,
                    resourceId: asset.id,
                    metadata: { externalId, deviceId, publicUrl }
                }
            });

            await AssetAnchoringService.createAssetRegistrationEvent(tx, {
                id: asset.id,
                tenantId: asset.tenantId,
                externalId: asset.externalId,
                deviceId: asset.deviceId,
                status: asset.status,
                publicUrl: asset.publicUrl,
                metadata,
                publicDataKeys: publicDataKeys || [],
                createdAt: asset.createdAt,
            }, {
                issuerId: secureContext.apiKeyId || 'asset.create',
                metadata,
                publicDataKeys: publicDataKeys || [],
            });

            return asset;
        });

        AnchorQueueService.processQueue({ tenantId }).catch(console.error);

        return asset;
    }

    /**
     * Get Asset by ID with isolation, including paginated events.
     */
    static async getAsset(secureContext: any, payload: { id: string, limit?: number, page?: number, cursor?: string }) {
        const tenantId = secureContext.tenantId;
        // RED TEAM HOTFIX 3 (Prisma Object Injection): String Casting
        const id = String(payload.id);

        const limit = payload.limit ? Math.min(Number(payload.limit), 100) : 20;

        let eventsQuery: any = {
            take: limit,
            orderBy: { createdAt: 'desc' }
        };

        if (payload.cursor) {
            eventsQuery = {
                ...eventsQuery,
                skip: 1, // Skip the cursor itself
                cursor: { id: payload.cursor }
            };
        } else if (payload.page) {
            const page = Number(payload.page);
            eventsQuery = {
                ...eventsQuery,
                skip: (page - 1) * limit
            };
        }

        const asset = await prisma.asset.findUnique({
            where: { id, tenantId },
            include: {
                owners: { where: { revokedAt: null } },
                device: true,
                events: eventsQuery
            }
        });

        if (!asset) return null;

        const eventsCount = asset.events.length;
        const hasMore = eventsCount === limit;
        const nextCursor = hasMore ? asset.events[eventsCount - 1].id : null;

        return {
            ...asset,
            pagination: {
                hasMore,
                nextCursor
            }
        };
    }

    /**
     * List Assets for a Tenant.
     */
    static async listAssets(secureContext: any, payload: any) {
        const tenantId = secureContext.tenantId;
        const page = payload.page ? Number(payload.page) : 1;
        const limit = payload.limit ? Number(payload.limit) : 20;

        // RED TEAM HOTFIX 3 (Prisma Object Injection): String Casting
        const externalId = payload.externalId ? String(payload.externalId) : undefined;
        const deviceId = payload.deviceId ? String(payload.deviceId) : undefined;

        // RED TEAM HOTFIX 8: Anti-OOM Pagination Lock
        const safeLimit = limit > 50 ? 50 : limit;
        const skip = (page - 1) * safeLimit;

        const where = {
            tenantId,
            ...(externalId && { externalId }),
            ...(deviceId && { deviceId })
        };

        const [items, total] = await Promise.all([
            prisma.asset.findMany({
                where,
                skip,
                take: safeLimit,
                orderBy: { createdAt: 'desc' },
                include: { owners: { where: { revokedAt: null } } }
            }),
            prisma.asset.count({ where })
        ]);

        return { items, total, page, limit: safeLimit };
    }

    /**
     * Update Asset Metadata or Flags.
     */
    static async updateAsset(secureContext: any, payload: any) {
        if (secureContext.role !== 'ADMIN') throw new Error('Forbidden: Insufficient privileges');

        const tenantId = String(secureContext.tenantId);
        const id = String(payload.id);

        // Remove o ID do payload para não tentar atualizá-lo no banco
        const { id: _removedId, tenantId: _removedTenantId, ...dataToUpdate } = payload;

        return await prisma.$transaction(async (tx) => {
            // RED TEAM HOTFIX 4: Prevent zombie resurrection
            const updateResult = await tx.asset.updateMany({
                where: {
                    id: id,
                    tenantId: tenantId,
                    status: { notIn: ['BURNED'] }
                },
                data: dataToUpdate
            });

            if (updateResult.count === 0) {
                throw new Error("State Transition Error: Asset not found, unauthorized, or in terminal state.");
            }

            return await tx.asset.findUnique({
                where: { id: id }
            });
        });
    }

    /**
     * Manage Owners (Atomic Add/Remove).
     */
    static async addOwner(
        assetIdOrContext: string | AddOwnerContext,
        tenantIdOrPayload: string | AddOwnerPayload,
        ownerDataArg?: {
            ownerRef: string;
            label?: string;
            sharePercent?: number;
        }
    ) {
        let assetId: string;
        let tenantId: string;
        let ownerData: AddOwnerPayload;
        let issuerId = 'asset.addOwner';

        if (typeof assetIdOrContext === 'string') {
            assetId = assetIdOrContext;
            tenantId = String(tenantIdOrPayload);
            ownerData = ownerDataArg as AddOwnerPayload;
        } else {
            const secureContext = assetIdOrContext;
            const payload = tenantIdOrPayload as AddOwnerPayload;

            if (secureContext.role && !['ADMIN', 'OPERATOR'].includes(secureContext.role)) {
                throw new Error('Forbidden: Insufficient privileges');
            }

            assetId = String(payload.assetId ?? payload.id ?? '');
            tenantId = secureContext.tenantId;
            ownerData = payload;
            issuerId = secureContext.apiKeyId || issuerId;
        }

        if (!assetId || !ownerData?.ownerRef) {
            throw new Error('assetId and ownerRef are required');
        }

        const owner = await prisma.$transaction(async (tx) => {
            // Verify ownership of the asset
            const asset = await tx.asset.findUnique({
                where: { id: assetId, tenantId },
                select: { id: true, tenantId: true }
            });

            if (!asset) throw new Error('Asset not found or unauthorized');

            const owner = await tx.owner.create({
                data: {
                    assetId,
                    ...ownerData
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    action: AuditActions.OWNER_ADDED,
                    resourceType: ResourceTypes.OWNER,
                    resourceId: owner.id,
                    metadata: { assetId, ownerRef: ownerData.ownerRef }
                }
            });

            const delegationPayload = {
                eventType: 'DELEGATION_GRANTED',
                schemaVersion: 1,
                assetId,
                tenantId,
                ownerId: owner.id,
                ownerRefHash: hashPrivateRef(ownerData.ownerRef),
                role: ownerData.label ?? 'delegate',
                sharePercent: ownerData.sharePercent ?? null,
                delegatedAt: new Date().toISOString(),
            };

            await tx.eventLog.create({
                data: {
                    assetId,
                    tenantId,
                    issuerId,
                    origin: 'DELEGATION',
                    status: 'APPROVED',
                    payload: delegationPayload,
                    signatureHash: AssetAnchoringService.signatureHash(delegationPayload),
                }
            });

            return owner;
        });

        AnchorQueueService.processQueue({ tenantId, assetId }).catch(console.error);

        return owner;
    }
}
