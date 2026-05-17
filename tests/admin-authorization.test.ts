import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiKeyRole,
  Prisma,
  TenantMembershipStatus,
  TenantMembershipRole,
  TenantStatus,
  TenantUserStatus,
  TenantUserRole,
} from '@prisma/client';

const { mockTenantUser } = vi.hoisted(() => ({
  mockTenantUser: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    tenantUser: mockTenantUser,
  },
}));

import {
  AdminAuthorizationError,
  AdminAuthorizationFacet,
} from '../src/services/core-facets/AdminAuthorizationFacet';
import {
  getPlatformTenantContactEmail,
  getPlatformTenantName,
  getPlatformTenantSlug,
} from '../src/config/platformTenant';
import { requireAdminReason, requirePlatformAdmin } from '../src/middleware/platformAdminAuth';
import { AuthenticatedRequest } from '../src/types';

describe('Phase 4 admin schema foundation', () => {
  it('exposes canonical tenant admin models and roles', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toContain('TenantUser');
    expect(modelNames).toContain('TenantMembership');
    expect(modelNames).toContain('ExternalIdentity');
    expect(modelNames).toContain('AdminAuditLog');
    expect(modelNames).toContain('ApiRequestAudit');
    expect(modelNames).toContain('TenantCommercialProfile');

    expect(TenantStatus.ACTIVE).toBe('ACTIVE');
    expect(TenantUserRole.PLATFORM_ADMIN).toBe('PLATFORM_ADMIN');
    expect(TenantMembershipRole.TENANT_ADMIN).toBe('TENANT_ADMIN');
  });

  it('keeps Quantum Cert as the immutable platform tenant identity', () => {
    const previousSlug = process.env.QUANTUM_TENANT_SLUG;
    const previousName = process.env.QUANTUM_TENANT_NAME;
    const previousEmail = process.env.QUANTUM_TENANT_CONTACT_EMAIL;

    process.env.QUANTUM_TENANT_SLUG = 'wrong-tenant';
    process.env.QUANTUM_TENANT_NAME = 'Wrong Tenant';
    process.env.QUANTUM_TENANT_CONTACT_EMAIL = 'wrong@example.com';

    expect(getPlatformTenantSlug()).toBe('quantum-cert-platform');
    expect(getPlatformTenantName()).toBe('Quantum Cert');
    expect(getPlatformTenantContactEmail()).toBe('platform@quantumcert.com');

    if (previousSlug === undefined) delete process.env.QUANTUM_TENANT_SLUG;
    else process.env.QUANTUM_TENANT_SLUG = previousSlug;
    if (previousName === undefined) delete process.env.QUANTUM_TENANT_NAME;
    else process.env.QUANTUM_TENANT_NAME = previousName;
    if (previousEmail === undefined) delete process.env.QUANTUM_TENANT_CONTACT_EMAIL;
    else process.env.QUANTUM_TENANT_CONTACT_EMAIL = previousEmail;
  });
});

describe('AdminAuthorizationFacet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves Quantum Platform Admin from canonical membership', async () => {
    mockTenantUser.findUnique.mockResolvedValue({
      id: 'user-platform',
      tenantId: 'tenant-quantum',
      status: TenantUserStatus.ACTIVE,
      memberships: [
        {
          tenantId: 'tenant-quantum',
          role: TenantMembershipRole.PLATFORM_ADMIN,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { id: 'tenant-quantum', slug: 'quantum-cert-platform' },
        },
      ],
    });

    const actor = await AdminAuthorizationFacet.requirePlatformAdmin({
      actorUserId: 'user-platform',
      reason: 'activate tenant',
      correlationId: 'corr-1',
    });

    expect(actor).toMatchObject({
      actorUserId: 'user-platform',
      actorTenantId: 'tenant-quantum',
      role: TenantMembershipRole.PLATFORM_ADMIN,
      reason: 'activate tenant',
      correlationId: 'corr-1',
    });
  });

  it('resolves Quantum Platform Admin from legacy dashboard openId during backfill', async () => {
    mockTenantUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'user-platform',
        tenantId: 'tenant-quantum',
        status: TenantUserStatus.ACTIVE,
        legacyOpenId: 'dashboard-openid-platform',
        memberships: [
          {
            tenantId: 'tenant-quantum',
            role: TenantMembershipRole.PLATFORM_ADMIN,
            status: TenantMembershipStatus.ACTIVE,
            tenant: { id: 'tenant-quantum', slug: 'quantum-cert-platform' },
          },
        ],
      });

    await expect(
      AdminAuthorizationFacet.requirePlatformAdmin({
        actorUserId: 'dashboard-openid-platform',
        reason: 'admin dashboard action',
      })
    ).resolves.toMatchObject({
      actorUserId: 'user-platform',
      actorTenantId: 'tenant-quantum',
      role: TenantMembershipRole.PLATFORM_ADMIN,
    });

    expect(mockTenantUser.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { legacyOpenId: 'dashboard-openid-platform' },
    }));
  });

  it('resolves local dashboard Platform Admin from email openId', async () => {
    mockTenantUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockTenantUser.findFirst.mockResolvedValue({
      id: 'user-platform-email',
      tenantId: 'tenant-quantum',
      status: TenantUserStatus.ACTIVE,
      memberships: [
        {
          tenantId: 'tenant-quantum',
          role: TenantMembershipRole.PLATFORM_ADMIN,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { id: 'tenant-quantum', slug: 'quantum-cert-platform' },
        },
      ],
    });

    const actor = await AdminAuthorizationFacet.requirePlatformAdmin({
      actorUserId: 'dev@localhost',
    });

    expect(actor).toMatchObject({
      actorUserId: 'user-platform-email',
      role: TenantMembershipRole.PLATFORM_ADMIN,
    });
    expect(mockTenantUser.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        email: 'dev@localhost',
        status: TenantUserStatus.ACTIVE,
      },
    }));
  });

  it('allows Tenant Admin only inside its own tenant', async () => {
    mockTenantUser.findUnique.mockResolvedValue({
      id: 'user-tenant-admin',
      tenantId: 'tenant-a',
      status: TenantUserStatus.ACTIVE,
      memberships: [
        {
          tenantId: 'tenant-a',
          role: TenantMembershipRole.TENANT_ADMIN,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { id: 'tenant-a', slug: 'tenant-a' },
        },
      ],
    });

    await expect(
      AdminAuthorizationFacet.requireTenantAdmin({
        actorUserId: 'user-tenant-admin',
        targetTenantId: 'tenant-b',
      })
    ).rejects.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' });

    await expect(
      AdminAuthorizationFacet.requireTenantAdmin({
        actorUserId: 'user-tenant-admin',
        targetTenantId: 'tenant-a',
      })
    ).resolves.toMatchObject({
      actorUserId: 'user-tenant-admin',
      tenantId: 'tenant-a',
      role: TenantMembershipRole.TENANT_ADMIN,
    });
  });

  it('does not treat ApiKeyRole.ADMIN as Quantum Platform Admin', async () => {
    const req = {
      apiKeyRole: ApiKeyRole.ADMIN,
      headers: {},
      body: { reason: 'cross-tenant operation' },
    } as AuthenticatedRequest;
    const res = createResponseMock();
    const next = vi.fn();

    await requirePlatformAdmin(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ADMIN_ACTOR_REQUIRED',
    }));
  });

  it('requires a reason for privileged admin mutations', () => {
    const req = { headers: {}, body: {} } as AuthenticatedRequest;
    const res = createResponseMock();
    const next = vi.fn();

    requireAdminReason(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ADMIN_REASON_REQUIRED',
    }));
    expect(() => AdminAuthorizationFacet.requireReason('  ')).toThrow(AdminAuthorizationError);
  });
});

function createResponseMock() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}
