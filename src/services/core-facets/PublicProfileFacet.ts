import { Asset } from '@prisma/client';

const asRecord = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
};

const textFrom = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
};

const tenantBrandFrom = (asset: any) => {
    const tenant = asRecord(asset?.tenant);
    const commercialProfile = asRecord(tenant.commercialProfile);
    const whiteLabel = asRecord(commercialProfile.whiteLabel);
    const name = textFrom(
        whiteLabel.displayName,
        whiteLabel.brandName,
        commercialProfile.legalName,
        tenant.name,
    );
    const logoUrl = textFrom(whiteLabel.logoUrl, whiteLabel.logo);
    const primaryColor = textFrom(whiteLabel.primaryColor);

    if (!name && !logoUrl) return undefined;

    return {
        ...(name ? { name } : {}),
        ...(textFrom(tenant.slug) ? { slug: textFrom(tenant.slug) } : {}),
        ...(logoUrl ? { logoUrl } : {}),
        ...(primaryColor ? { primaryColor } : {}),
    };
};

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
            tenantBrand: tenantBrandFrom(asset),
            isAlert: asset.status === 'ALERT'
        };
    }
}
