import { Response } from 'express';
import { ContextRouterFacet } from '../services/core-facets/ContextRouterFacet';
import { AuthenticatedRequest, ApiResponse } from '../types';

export class ContextRouterController {
    static async getAsset(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const isAuthenticated = !!req.tenantId;

            const result = await ContextRouterFacet.routeAssetRead(id, {
                tenantId: req.tenantId,
                isAuthenticated
            });

            if (!result) {
                return res.status(404).json({ success: false, error: 'Asset not found' });
            }

            const response: ApiResponse = {
                success: true,
                data: result.asset,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: result.context === 'AUTHENTICATED' ? 'ROUTER_AUTHENTICATED' : 'ROUTER_PUBLIC'
                }
            };
            return res.json(response);
        } catch (error: any) {
            if (error.message === "UNAUTHORIZED_TENANT") {
                return res.status(403).json({ success: false, error: 'Unauthorized access to asset from a different tenant' });
            }
            console.error('[ContextRouterController]', error);
            return res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
}
