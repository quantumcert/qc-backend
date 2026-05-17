import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiKeyRole,
  TenantMembershipRole,
  TenantStatus,
} from '@prisma/client';
import { AdminActorContext } from '../src/types';

const {
  mockTenant,
  mockApiKey,
  mockAdminAuditLog,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTenant = {
    findUnique: vi.fn(),
  };
  const mockApiKey = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockAdminAuditLog = {
    create: vi.fn(),
  };
  const mockTransaction = vi.fn(async (callback) => callback({
    apiKey: mockApiKey,
    adminAuditLog: mockAdminAuditLog,
  }));

  return {
    mockTenant,
    mockApiKey,
    mockAdminAuditLog,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    apiKey: mockApiKey,
    adminAuditLog: mockAdminAuditLog,
    $transaction: mockTransaction,
  },
}));

import { ApiKeyManagementFacet } from '../src/services/core-facets/ApiKeyManagementFacet';
import { AdminApiKeyOperationsFacet } from '../src/services/core-facets/AdminApiKeyOperationsFacet';

const platformActor: AdminActorContext = {
  actorUserId: 'user-platform',
  actorTenantId: 'tenant-quantum',
  role: TenantMembershipRole.PLATFORM_ADMIN,
  reason: 'gestao operacional de credenciais',
  correlationId: 'corr-api-key-1',
};

const tenantAdminActor: AdminActorContext = {
  actorUserId: 'user-tenant-admin',
  actorTenantId: 'tenant-b2b',
  tenantId: 'tenant-b2b',
  role: TenantMembershipRole.TENANT_ADMIN,
  reason: 'tenant tentando emitir chave',
};

function apiKeyFixture(overrides = {}) {
  return {
    id: 'api-key-1',
    tenantId: 'tenant-b2b',
    keyPrefix: 'qc_test_prefix01',
    label: 'Main integration',
    role: ApiKeyRole.OPERATOR,
    scopes: ['assets:write'],
    isActive: true,
    revokedAt: null,
    lastUsedAt: null,
    expiresAt: null,
    createdByActorId: 'user-platform',
    revokedByActorId: null,
    revocationReason: null,
    rotatedFromApiKeyId: null,
    lastRotatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminApiKeyOperationsFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ApiKeyManagementFacet, 'buildKeyMaterial').mockResolvedValue({
      rawKey: 'qc_test_raw_secret_value',
      keyHash: 'bcrypt-hash-only',
      keyPrefix: 'qc_test_prefix01',
    });
    mockTransaction.mockImplementation(async (callback) => callback({
      apiKey: mockApiKey,
      adminAuditLog: mockAdminAuditLog,
    }));
  });

  it('creates the initial tenant API key only for an active tenant and returns raw key once', async () => {
    mockTenant.findUnique.mockResolvedValue({
      id: 'tenant-b2b',
      isActive: true,
      status: TenantStatus.ACTIVE,
    });
    mockApiKey.findFirst.mockResolvedValue(null);
    mockApiKey.create.mockResolvedValue(apiKeyFixture());

    const result = await AdminApiKeyOperationsFacet.createInitialApiKey(platformActor, 'tenant-b2b', {
      label: ' Main integration ',
      role: ApiKeyRole.OPERATOR,
      scopes: ['assets:write', 'assets:write', ' events:read '],
      reason: 'primeira chave do tenant aprovada',
    });

    expect(result).toMatchObject({
      id: 'api-key-1',
      rawKey: 'qc_test_raw_secret_value',
      keyPrefix: 'qc_test_prefix01',
      role: ApiKeyRole.OPERATOR,
    });
    expect(mockApiKey.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        keyHash: 'bcrypt-hash-only',
        keyPrefix: 'qc_test_prefix01',
        label: 'Main integration',
        role: ApiKeyRole.OPERATOR,
        scopes: ['assets:write', 'events:read'],
        createdByActorId: 'user-platform',
      }),
    }));
    const persistedPayload = JSON.stringify(mockApiKey.create.mock.calls);
    expect(persistedPayload).not.toContain('qc_test_raw_secret_value');
    expect(mockAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        actorUserId: 'user-platform',
        action: 'API_KEY_INITIAL_CREATED',
        resourceType: 'ApiKey',
        reason: 'primeira chave do tenant aprovada',
      }),
    }));
  });

  it('lists only key prefixes and metadata without raw secret or hash', async () => {
    mockTenant.findUnique.mockResolvedValue({ id: 'tenant-b2b' });
    mockApiKey.findMany.mockResolvedValue([apiKeyFixture()]);
    mockApiKey.count.mockResolvedValue(1);

    const result = await AdminApiKeyOperationsFacet.listTenantApiKeys(platformActor, 'tenant-b2b', {
      includeRevoked: true,
    });

    expect(result.apiKeys).toHaveLength(1);
    expect(result.apiKeys[0]).not.toHaveProperty('rawKey');
    expect(result.apiKeys[0]).not.toHaveProperty('keyHash');
    expect(JSON.stringify(result)).not.toContain('qc_test_raw_secret_value');
    expect(mockApiKey.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({
        keyHash: expect.anything(),
      }),
    }));
  });

  it('rotates an API key by revoking the old key and returning only the new raw key', async () => {
    mockApiKey.findFirst.mockResolvedValue(apiKeyFixture({
      id: 'api-key-old',
      keyPrefix: 'qc_test_oldpref',
    }));
    mockApiKey.create.mockResolvedValue(apiKeyFixture({
      id: 'api-key-new',
      keyPrefix: 'qc_test_prefix01',
      rotatedFromApiKeyId: 'api-key-old',
    }));

    const result = await AdminApiKeyOperationsFacet.rotateApiKey(
      platformActor,
      'tenant-b2b',
      'api-key-old',
      { reason: 'rotacao solicitada pelo cliente' }
    );

    expect(result).toMatchObject({
      id: 'api-key-new',
      previousKeyId: 'api-key-old',
      rawKey: 'qc_test_raw_secret_value',
      rotatedFromApiKeyId: 'api-key-old',
    });
    expect(mockApiKey.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'api-key-old' },
      data: expect.objectContaining({
        isActive: false,
        revokedByActorId: 'user-platform',
        revocationReason: 'rotacao solicitada pelo cliente',
      }),
    }));
    expect(mockApiKey.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        keyHash: 'bcrypt-hash-only',
        rotatedFromApiKeyId: 'api-key-old',
        createdByActorId: 'user-platform',
      }),
    }));
    expect(JSON.stringify(mockApiKey.create.mock.calls)).not.toContain('qc_test_raw_secret_value');
    expect(mockAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'API_KEY_ROTATED',
        reason: 'rotacao solicitada pelo cliente',
      }),
    }));
  });

  it('revokes an API key with actor and reason in admin audit', async () => {
    mockApiKey.findFirst.mockResolvedValue(apiKeyFixture({
      id: 'api-key-1',
      keyPrefix: 'qc_test_prefix01',
    }));
    mockApiKey.update.mockResolvedValue(apiKeyFixture({
      id: 'api-key-1',
      isActive: false,
      revokedAt: new Date('2026-01-02T00:00:00.000Z'),
      revokedByActorId: 'user-platform',
      revocationReason: 'credencial comprometida',
    }));

    const result = await AdminApiKeyOperationsFacet.revokeApiKey(
      platformActor,
      'tenant-b2b',
      'api-key-1',
      { reason: 'credencial comprometida' }
    );

    expect(result).toMatchObject({
      id: 'api-key-1',
      isActive: false,
      revokedByActorId: 'user-platform',
      revocationReason: 'credencial comprometida',
    });
    expect(mockAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        actorUserId: 'user-platform',
        action: 'API_KEY_REVOKED',
        reason: 'credencial comprometida',
      }),
    }));
  });

  it('denies initial key issuance from tenant admins and requires a reason', async () => {
    await expect(
      AdminApiKeyOperationsFacet.createInitialApiKey(tenantAdminActor, 'tenant-b2b', {
        label: 'Tenant self-service',
        reason: 'tentativa fora da plataforma',
      })
    ).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });

    await expect(
      AdminApiKeyOperationsFacet.createInitialApiKey(
        { ...platformActor, reason: undefined },
        'tenant-b2b',
        { label: 'Missing reason' }
      )
    ).rejects.toMatchObject({ code: 'ADMIN_REASON_REQUIRED' });

    expect(mockApiKey.create).not.toHaveBeenCalled();
    expect(mockAdminAuditLog.create).not.toHaveBeenCalled();
  });
});
