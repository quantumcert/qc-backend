import prisma from '../../config/prisma';
import { PublicProfileFacet } from './PublicProfileFacet';

export class ContextRouterFacet {
    static async routeAssetRead(assetId: string, context: { tenantId?: string; isAuthenticated: boolean }) {
        const asset = await prisma.asset.findUnique({
            where: { id: assetId },
            include: {
                owners: { where: { revokedAt: null } },
                device: true,
                events: { where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' } }
            }
        });

        if (!asset) {
            return null;
        }

        // Case A: Authenticated Context
        if (context.isAuthenticated && context.tenantId) {
            if (asset.tenantId !== context.tenantId) {
                throw new Error("UNAUTHORIZED_TENANT");
            }
            return {
                context: 'AUTHENTICATED',
                asset: asset
            };
        }

        // Case B: Public / QR Code Context
        // Deviate to PublicProfileFacet explicitly
        return {
            context: 'PUBLIC',
            asset: PublicProfileFacet.filterAsset(asset)
        };
    }
}
