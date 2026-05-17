import bcrypt from 'bcryptjs';
import { ApiKeyRole } from '@prisma/client';
import { resolveEffectiveApiKeyScopes } from '../security/apiKeyScopes';

type EnsureConfiguredApiKeyOptions = {
    tenantId: string;
    rawKey?: string | null;
    label?: string;
    nodeEnv?: string;
};

export async function ensureConfiguredLocalApiKey(prisma: any, options: EnsureConfiguredApiKeyOptions) {
    const rawKey = options.rawKey?.trim();
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

    if (!rawKey) {
        return { created: false, reason: 'missing-key' as const };
    }

    if (nodeEnv === 'production') {
        return { created: false, reason: 'production' as const };
    }

    const keyPrefix = rawKey.substring(0, 16);
    const existingKeys = await prisma.apiKey.findMany({
        where: {
            tenantId: options.tenantId,
            keyPrefix,
            isActive: true,
            revokedAt: null,
        },
    });

    for (const existingKey of existingKeys) {
        if (await bcrypt.compare(rawKey, existingKey.keyHash)) {
            return {
                created: false,
                reason: 'already-present' as const,
                id: existingKey.id,
                keyPrefix,
            };
        }
    }

    const keyHash = await bcrypt.hash(rawKey, 10);
    const apiKey = await prisma.apiKey.create({
        data: {
            tenantId: options.tenantId,
            keyHash,
            keyPrefix,
            label: options.label ?? 'Local Dashboard/Docs API Key',
            role: ApiKeyRole.ADMIN,
            scopes: resolveEffectiveApiKeyScopes(undefined, ApiKeyRole.ADMIN),
        },
    });

    return {
        created: true,
        reason: 'created' as const,
        id: apiKey.id,
        keyPrefix,
    };
}
