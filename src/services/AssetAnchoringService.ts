import crypto from 'crypto';

export const ASSET_REGISTRATION_ORIGIN = 'SYSTEM_ASSET_REGISTRATION';

type AssetRegistrationInput = {
  id: string;
  tenantId: string;
  externalId?: string | null;
  deviceId?: string | null;
  status?: string | null;
  publicUrl?: string | null;
  metadata?: unknown;
  publicDataKeys?: string[] | null;
  createdAt?: Date | string | null;
};

type AssetRegistrationEventOptions = {
  issuerId?: string | null;
  metadata?: unknown;
  publicDataKeys?: string[] | null;
};

function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date().toISOString();
}

export class AssetAnchoringService {
  static buildAssetRegistrationPayload(
    asset: AssetRegistrationInput,
    options: AssetRegistrationEventOptions = {},
  ) {
    return {
      eventType: 'ASSET_REGISTERED',
      schemaVersion: 1,
      assetId: asset.id,
      tenantId: asset.tenantId,
      externalId: asset.externalId ?? null,
      deviceId: asset.deviceId ?? null,
      status: asset.status ?? 'ACTIVE',
      publicUrl: asset.publicUrl ?? null,
      metadata: options.metadata ?? asset.metadata ?? {},
      publicDataKeys: options.publicDataKeys ?? asset.publicDataKeys ?? [],
      registeredAt: toIso(asset.createdAt),
    };
  }

  static signatureHash(payload: unknown): string {
    return crypto.createHash('sha3-512').update(JSON.stringify(payload)).digest('hex');
  }

  static async createAssetRegistrationEvent(
    db: any,
    asset: AssetRegistrationInput,
    options: AssetRegistrationEventOptions = {},
  ) {
    const payload = AssetAnchoringService.buildAssetRegistrationPayload(asset, options);

    return db.eventLog.create({
      data: {
        assetId: asset.id,
        tenantId: asset.tenantId,
        issuerId: options.issuerId ?? ASSET_REGISTRATION_ORIGIN,
        origin: ASSET_REGISTRATION_ORIGIN,
        status: 'APPROVED',
        payload,
        signatureHash: AssetAnchoringService.signatureHash(payload),
      },
    });
  }
}
