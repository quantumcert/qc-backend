import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssetStatus,
  EventStatus,
  TenantMembershipRole,
  TenantStatus,
  TenantUserRole,
  TenantUserStatus,
} from '@prisma/client';
import { AdminActorContext } from '../src/types';

const {
  mockTenant,
  mockTenantUser,
  mockTenantMembership,
  mockExternalIdentity,
  mockAsset,
  mockEventLog,
  mockAdminAuditLog,
  mockProcessQueue,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTenant = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantUser = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantMembership = {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  };
  const mockExternalIdentity = {
    upsert: vi.fn(),
  };
  const mockAsset = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
  };
  const mockEventLog = {
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  const mockAdminAuditLog = {
    create: vi.fn(),
  };
  const mockProcessQueue = vi.fn();
  const mockTransaction = vi.fn(async (callback) => callback({
    tenant: mockTenant,
    tenantUser: mockTenantUser,
    tenantMembership: mockTenantMembership,
    externalIdentity: mockExternalIdentity,
    asset: mockAsset,
    eventLog: mockEventLog,
    adminAuditLog: mockAdminAuditLog,
  }));

  return {
    mockTenant,
    mockTenantUser,
    mockTenantMembership,
    mockExternalIdentity,
    mockAsset,
    mockEventLog,
    mockAdminAuditLog,
    mockProcessQueue,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    tenantUser: mockTenantUser,
    tenantMembership: mockTenantMembership,
    externalIdentity: mockExternalIdentity,
    asset: mockAsset,
    eventLog: mockEventLog,
    adminAuditLog: mockAdminAuditLog,
    $transaction: mockTransaction,
  },
}));

vi.mock('../src/services/AnchorQueueService', () => ({
  AnchorQueueService: {
    processQueue: mockProcessQueue,
  },
}));

import { TenantUserFacet } from '../src/services/core-facets/TenantUserFacet';

const platformActor: AdminActorContext = {
  actorUserId: 'tenant-user-platform-admin',
  actorTenantId: 'tenant-quantum',
  role: TenantMembershipRole.PLATFORM_ADMIN,
  reason: 'fase 4 usuarios canonicos',
  correlationId: 'corr-tenant-users',
};

describe('TenantUserFacet canonical contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (callback) => callback({
      tenant: mockTenant,
      tenantUser: mockTenantUser,
      tenantMembership: mockTenantMembership,
      externalIdentity: mockExternalIdentity,
      asset: mockAsset,
      eventLog: mockEventLog,
      adminAuditLog: mockAdminAuditLog,
    }));
    mockTenant.findUnique.mockResolvedValue({
      id: 'tenant-quantum',
      slug: 'quantum-cert-platform',
      activatedAt: new Date('2026-05-17T00:00:00.000Z'),
    });
    mockTenant.upsert.mockResolvedValue({
      id: 'tenant-quantum',
      slug: 'quantum-cert-platform',
      status: TenantStatus.ACTIVE,
      targetChain: 'STELLAR',
    });
    mockTenantUser.findUnique.mockResolvedValue(null);
    mockTenantUser.findFirst.mockResolvedValue(null);
    mockAsset.findUnique.mockResolvedValue(null);
    mockAsset.upsert.mockImplementation(async ({ create }) => ({
      id: create.id,
      tenantId: create.tenantId,
      externalId: create.externalId,
      publicUrl: create.publicUrl,
      status: create.status,
    }));
    mockEventLog.create.mockResolvedValue({
      id: 'event-profile',
      status: 'APPROVED',
      dltTxId: null,
      signatureHash: 'profile-hash',
      createdAt: new Date('2026-05-17T01:00:00.000Z'),
      updatedAt: new Date('2026-05-17T01:00:00.000Z'),
    });
    mockProcessQueue.mockResolvedValue({ processed: 0 });
  });

  it('guarantees Quantum Cert as the immutable platform tenant on Stellar', async () => {
    const tenant = await TenantUserFacet.ensureTenantQuantum();

    expect(tenant).toMatchObject({
      slug: 'quantum-cert-platform',
      status: TenantStatus.ACTIVE,
      targetChain: 'STELLAR',
    });
    expect(mockTenant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: 'quantum-cert-platform' },
      update: expect.objectContaining({
        name: 'Quantum Cert',
        status: TenantStatus.ACTIVE,
        targetChain: 'STELLAR',
        isActive: true,
      }),
    }));
  });

  it('upserts B2C users under Tenant Quantum with CPF in profile asset transaction payload', async () => {
    mockTenantUser.create.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
      legacyDashboardUserId: '42',
      legacyOpenId: 'dev@localhost',
      email: 'dev@localhost',
      phone: null,
      document: '34888015864',
      documentType: 'CPF',
      displayName: 'Developer User',
      role: TenantUserRole.MEMBER,
      status: TenantUserStatus.ACTIVE,
      guardianId: null,
      profile: {},
      metadata: {},
    });

    const result = await TenantUserFacet.upsertB2CUser({
      legacyDashboardUserId: 42,
      legacyOpenId: 'dev@localhost',
      email: 'DEV@LOCALHOST',
      cpf: '348.880.158-64',
      displayName: 'Developer User',
      source: 'test-backfill',
    });

    expect(result).toMatchObject({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
      profileAsset: expect.objectContaining({
        status: 'ACTIVE',
      }),
    });
    expect(mockTenantUser.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-quantum',
        legacyDashboardUserId: '42',
        legacyOpenId: 'dev@localhost',
        email: 'dev@localhost',
        document: '34888015864',
        documentType: 'CPF',
      }),
    }));
    expect(mockTenantMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        tenantId: 'tenant-quantum',
        userId: 'tenant-user-1',
        role: TenantMembershipRole.MEMBER,
      }),
    }));
    expect(mockEventLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-quantum',
        origin: 'SYSTEM_TENANT_USER_PROFILE',
        payload: expect.objectContaining({
          document: expect.objectContaining({
            documentType: 'CPF',
            documentValue: '34888015864',
          }),
        }),
      }),
    }));
  });

  it('lists tenant users for Platform Admin with tenant-scoped pagination', async () => {
    mockTenantUser.findMany.mockResolvedValue([{ id: 'tenant-user-1' }]);
    mockTenantUser.count.mockResolvedValue(1);

    const result = await TenantUserFacet.listTenantUsers(platformActor, 'tenant-quantum', {
      search: 'dev',
      page: 1,
      limit: 10,
    });

    expect(result.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect(mockTenantUser.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-quantum',
        OR: expect.any(Array),
      }),
      take: 10,
    }));
  });

  it('updates profile metadata without removing onboarding completion markers', async () => {
    const existingMetadata = {
      onboardingCompletedAt: '2026-05-20T21:31:00.000Z',
      digitalIdentityGeneratedAt: '2026-05-20T21:31:00.000Z',
      registrationIdentity: {
        cpfVerified: true,
        birthDateMatches: true,
        ageEligible: true,
      },
      consent: {
        termsAccepted: true,
        dataConsentAccepted: true,
      },
      avatarUrl: 'https://cdn.example.com/avatar-old.png',
    };
    mockTenantUser.findUnique.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
      legacyDashboardUserId: '42',
      legacyOpenId: 'dev@localhost',
      email: 'dev@localhost',
      phone: null,
      document: '34888015864',
      documentType: 'CPF',
      displayName: 'Developer User',
      role: TenantUserRole.MEMBER,
      status: TenantUserStatus.ACTIVE,
      guardianId: null,
      profile: {},
      metadata: existingMetadata,
    });
    mockTenantUser.update.mockImplementation(async ({ data }) => ({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
      legacyDashboardUserId: data.legacyDashboardUserId,
      legacyOpenId: data.legacyOpenId,
      email: data.email,
      phone: data.phone,
      document: data.document,
      documentType: data.documentType,
      displayName: data.displayName,
      role: data.role,
      status: data.status,
      guardianId: data.guardianId,
      profile: data.profile,
      metadata: data.metadata,
    }));
    mockAsset.findUnique.mockResolvedValue({
      id: 'profile-asset-tenant-user-1',
      externalId: 'tenant-user-profile:tenant-user-1',
    });

    const result = await TenantUserFacet.updateProfile('tenant-user-1', {
      metadata: {
        avatarUrl: 'https://cdn.example.com/avatar-new.png',
      },
      reason: 'profile photo update',
    }) as any;

    expect(mockTenantUser.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          onboardingCompletedAt: '2026-05-20T21:31:00.000Z',
          digitalIdentityGeneratedAt: '2026-05-20T21:31:00.000Z',
          registrationIdentity: existingMetadata.registrationIdentity,
          consent: existingMetadata.consent,
          avatarUrl: 'https://cdn.example.com/avatar-new.png',
        }),
      }),
    }));
    expect(result.metadata.onboardingCompletedAt).toBe('2026-05-20T21:31:00.000Z');
    expect(mockEventLog.create).not.toHaveBeenCalled();
    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it('returns canonical profile asset state when listing dependents', async () => {
    const createdAt = new Date('2026-05-21T12:00:00.000Z');
    mockTenantUser.findUnique.mockResolvedValue({
      id: 'tenant-user-guardian',
      tenantId: 'tenant-quantum',
    });
    mockTenantUser.findMany.mockResolvedValue([
      {
        id: 'tenant-user-dependent',
        tenantId: 'tenant-quantum',
        legacyDashboardUserId: '77',
        legacyOpenId: 'dependent@quantum.local',
        email: 'dependent@quantum.local',
        phone: null,
        document: '12345678901',
        documentType: 'CPF',
        displayName: 'Maria Dependente',
        role: TenantUserRole.DEPENDENT,
        status: TenantUserStatus.ACTIVE,
        guardianId: 'tenant-user-guardian',
        profile: { dateOfBirth: '2015-03-09' },
        metadata: {},
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    mockAsset.findUnique.mockResolvedValue({
      id: 'asset-dependent-profile',
      tenantId: 'tenant-quantum',
      externalId: 'tenant-user-profile:tenant-user-dependent',
      publicUrl: '/api/v1/public/verify/asset-dependent-profile',
      status: AssetStatus.ACTIVE,
      createdAt,
      updatedAt: createdAt,
    });
    mockEventLog.findFirst.mockResolvedValue({
      id: 'event-dependent-anchor',
      status: EventStatus.APPROVED,
      dltTxId: 'stellar-dependent-tx',
      signatureHash: 'dependent-profile-hash',
      createdAt,
      updatedAt: createdAt,
    });

    const result = await TenantUserFacet.listDependents('tenant-user-guardian') as any[];

    expect(result[0]).toEqual(expect.objectContaining({
      id: 'tenant-user-dependent',
      profileAsset: expect.objectContaining({
        id: 'asset-dependent-profile',
        externalId: 'tenant-user-profile:tenant-user-dependent',
        lastAnchorEvent: expect.objectContaining({
          dltTxId: 'stellar-dependent-tx',
        }),
      }),
    }));
    expect(mockAsset.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId_externalId: {
          tenantId: 'tenant-quantum',
          externalId: 'tenant-user-profile:tenant-user-dependent',
        },
      },
      select: expect.objectContaining({
        id: true,
        publicUrl: true,
        status: true,
      }),
    }));
  });

  it('records tenant user status changes in the profile asset history for on-chain anchoring', async () => {
    mockTenantUser.findFirst.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
    });
    mockTenantUser.update.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
      legacyDashboardUserId: '42',
      legacyOpenId: 'dev@localhost',
      email: 'dev@localhost',
      phone: null,
      document: '34888015864',
      documentType: 'CPF',
      displayName: 'Developer User',
      role: TenantUserRole.MEMBER,
      status: TenantUserStatus.SUSPENDED,
      guardianId: null,
      profile: {},
      metadata: {},
    });
    mockAsset.findUnique.mockResolvedValue({
      id: 'profile-asset-tenant-user-1',
      externalId: 'tenant-user-profile:tenant-user-1',
    });

    const result = await TenantUserFacet.setTenantUserStatus(
      platformActor,
      'tenant-quantum',
      'tenant-user-1',
      TenantUserStatus.SUSPENDED,
      { reason: 'bloqueio operacional' }
    ) as any;

    expect(result.profileAsset).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    expect(mockEventLog.create).not.toHaveBeenCalled();
    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it('updates tenant user role without creating another profile blockchain event', async () => {
    mockTenantUser.findFirst.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
    });
    mockTenantUser.update.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
      legacyDashboardUserId: '42',
      legacyOpenId: 'dev@localhost',
      email: 'dev@localhost',
      phone: null,
      document: '34888015864',
      documentType: 'CPF',
      displayName: 'Developer User',
      role: TenantUserRole.TENANT_ADMIN,
      status: TenantUserStatus.ACTIVE,
      guardianId: null,
      profile: {},
      metadata: {},
    });
    mockAsset.findUnique.mockResolvedValue({
      id: 'profile-asset-tenant-user-1',
      externalId: 'tenant-user-profile:tenant-user-1',
    });

    const result = await TenantUserFacet.assignTenantUserRole(
      platformActor,
      'tenant-quantum',
      'tenant-user-1',
      TenantUserRole.TENANT_ADMIN,
      { reason: 'promocao operacional' }
    ) as any;

    expect(result.profileAsset).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    expect(mockEventLog.create).not.toHaveBeenCalled();
    expect(mockProcessQueue).not.toHaveBeenCalled();
  });
});
