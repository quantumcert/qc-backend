import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { ensureConfiguredLocalApiKey } from '../src/seeds/bootstrap-configured-api-key';

describe('ensureConfiguredLocalApiKey', () => {
    it('cria hash da chave local configurada sem persistir a chave bruta', async () => {
        const prisma = {
            apiKey: {
                findMany: vi.fn().mockResolvedValue([]),
                create: vi.fn().mockResolvedValue({ id: 'api-key-local' }),
            },
        };
        const rawKey = 'qc_test_local_configured_key_1234567890';

        const result = await ensureConfiguredLocalApiKey(prisma, {
            tenantId: 'tenant-quantum',
            rawKey,
            nodeEnv: 'development',
        });

        expect(result).toMatchObject({
            created: true,
            id: 'api-key-local',
            keyPrefix: rawKey.substring(0, 16),
        });
        expect(prisma.apiKey.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: 'tenant-quantum',
                keyPrefix: rawKey.substring(0, 16),
                role: 'ADMIN',
                scopes: expect.arrayContaining(['assets:write']),
            }),
        }));

        const persistedHash = prisma.apiKey.create.mock.calls[0][0].data.keyHash;
        expect(persistedHash).not.toBe(rawKey);
        await expect(bcrypt.compare(rawKey, persistedHash)).resolves.toBe(true);
    });

    it('não recria a chave quando o hash já valida o raw key configurado', async () => {
        const rawKey = 'qc_test_existing_configured_key_1234567890';
        const keyHash = await bcrypt.hash(rawKey, 10);
        const prisma = {
            apiKey: {
                findMany: vi.fn().mockResolvedValue([{ id: 'api-key-existing', keyHash }]),
                create: vi.fn(),
            },
        };

        const result = await ensureConfiguredLocalApiKey(prisma, {
            tenantId: 'tenant-quantum',
            rawKey,
            nodeEnv: 'development',
        });

        expect(result).toMatchObject({
            created: false,
            reason: 'already-present',
            id: 'api-key-existing',
        });
        expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });

    it('ignora a chave configurada em produção', async () => {
        const prisma = {
            apiKey: {
                findMany: vi.fn(),
                create: vi.fn(),
            },
        };

        const result = await ensureConfiguredLocalApiKey(prisma, {
            tenantId: 'tenant-quantum',
            rawKey: 'qc_live_should_not_seed',
            nodeEnv: 'production',
        });

        expect(result).toEqual({ created: false, reason: 'production' });
        expect(prisma.apiKey.findMany).not.toHaveBeenCalled();
        expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });
});
