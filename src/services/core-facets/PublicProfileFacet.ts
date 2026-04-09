import { Asset } from '@prisma/client';

export class PublicProfileFacet {
    static filterAsset(asset: any) {
        if (!asset) return null;

        const metadata = asset.metadata || {};
        const publicKeys = asset.publicDataKeys || [];

        const filteredMetadata: Record<string, any> = {};
        for (const key of publicKeys) {
            if (key in metadata) {
                filteredMetadata[key] = metadata[key];
            }
        }

        return {
            id: asset.id,
            externalId: asset.externalId,
            publicUrl: asset.publicUrl,
            metadata: filteredMetadata,
            isFractionable: asset.isFractionable,
            isFungible: asset.isFungible,
            createdAt: asset.createdAt,
            events: asset.events || [],
            isAlert: asset.status === 'ALERT'
        };
    }
}
