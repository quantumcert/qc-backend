// ═══════════════════════════════════════════════════════════
// ASSET CONTROLLER
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Agnostic Asset Engine
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { AssetRegistryFacet } from '../services/core-facets/AssetRegistryFacet';
import { AuthenticatedRequest, DiamondFacets, ApiResponse } from '../types';
import { z } from 'zod';

// Validators
const CreateAssetSchema = z.object({
    externalId: z.string().optional(),
    deviceId: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    owners: z.array(z.object({
        ownerRef: z.string(),
        label: z.string().optional(),
        sharePercent: z.number().optional()
    })).optional(),
    publicDataKeys: z.array(z.string()).optional(),
    isFractionable: z.boolean().optional(),
    isFungible: z.boolean().optional(),
    totalSupply: z.number().optional(),
    status: z.enum(['ACTIVE', 'ALERT', 'INACTIVE', 'BURNED']).optional()
});

export class AssetController {
    /**
     * POST /v1/assets
     */
    static async create(req: AuthenticatedRequest, res: Response) {
        const tenantId = req.tenantId!; // Injected by apiKeyAuth
        const body = CreateAssetSchema.parse(req.body);

        const asset = await AssetRegistryFacet.createAsset(
            { tenantId: req.tenantId, role: (req as any).apiKeyRole || 'ADMIN' },
            body
        );

        const response: ApiResponse = {
            success: true,
            data: asset,
            meta: {
                timestamp: new Date().toISOString(),
                facet: DiamondFacets.ASSET_REGISTRY
            }
        };

        res.status(201).json(response);
    }

    /**
     * GET /v1/assets
     */
    static async list(req: AuthenticatedRequest, res: Response) {
        const tenantId = req.tenantId!;
        const { page, limit, externalId, deviceId } = req.query;

        const result = await AssetRegistryFacet.listAssets(
            { tenantId },
            {
                page: page ? parseInt(page as string) : undefined,
                limit: limit ? parseInt(limit as string) : undefined,
                externalId: externalId as string,
                deviceId: deviceId as string
            }
        );

        const response: ApiResponse = {
            success: true,
            data: result,
            meta: {
                timestamp: new Date().toISOString(),
                facet: DiamondFacets.ASSET_REGISTRY
            }
        };

        res.json(response);
    }

    /**
     * GET /v1/assets/:id
     * Returns Asset ontologic details, including a paginated list of events.
     */
    static async getById(req: AuthenticatedRequest, res: Response) {
        const tenantId = req.tenantId!;
        const { id } = req.params;
        const { limit, page, cursor } = req.query;

        const asset = await AssetRegistryFacet.getAsset(
            { tenantId },
            {
                id,
                limit: limit ? Number(limit) : undefined,
                page: page ? Number(page) : undefined,
                cursor: cursor as string
            }
        );

        if (!asset) {
            return res.status(404).json({ success: false, error: 'Asset not found' });
        }

        const response: ApiResponse = {
            success: true,
            data: asset,
            meta: {
                timestamp: new Date().toISOString(),
                facet: DiamondFacets.ASSET_REGISTRY
            }
        };

        res.json(response);
    }

    /**
     * PATCH /v1/assets/:id/owners
     */
    static async addOwner(req: AuthenticatedRequest, res: Response) {
        const tenantId = req.tenantId!;
        const { id } = req.params;
        const body = z.object({
            ownerRef: z.string(),
            label: z.string().optional(),
            sharePercent: z.number().optional()
        }).parse(req.body);

        const owner = await AssetRegistryFacet.addOwner(id, tenantId, body);

        const response: ApiResponse = {
            success: true,
            data: owner,
            meta: {
                timestamp: new Date().toISOString(),
                facet: DiamondFacets.ASSET_REGISTRY
            }
        };

        res.status(201).json(response);
    }
}
