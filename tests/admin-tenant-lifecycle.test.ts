import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanTier, TenantMembershipRole, TenantStatus } from '@prisma/client';
import { AdminActorContext } from '../src/types';

const {
  mockTenant,
  mockTenantCommercialProfile,
  mockAdminAuditLog,
  mockAsset,
  mockEventLog,
  mockProcessQueue,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTenant = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantCommercialProfile = {
    create: vi.fn(),
    upsert: vi.fn(),
  };
  const mockAdminAuditLog = {
    create: vi.fn(),
  };
  const mockAsset = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  const mockEventLog = {
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  const mockProcessQueue = vi.fn();
  const mockTransaction = vi.fn(async (callback) => callback({
    tenant: mockTenant,
    tenantCommercialProfile: mockTenantCommercialProfile,
    adminAuditLog: mockAdminAuditLog,
    asset: mockAsset,
    eventLog: mockEventLog,
  }));

  return {
    mockTenant,
    mockTenantCommercialProfile,
    mockAdminAuditLog,
    mockAsset,
    mockEventLog,
    mockProcessQueue,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    tenantCommercialProfile: mockTenantCommercialProfile,
    adminAuditLog: mockAdminAuditLog,
    asset: mockAsset,
    eventLog: mockEventLog,
    $transaction: mockTransaction,
  },
}));

vi.mock('../src/services/AnchorQueueService', () => ({
  AnchorQueueService: {
    processQueue: mockProcessQueue,
  },
}));

import {
  AdminTenantOperationsFacet,
} from '../src/services/core-facets/AdminTenantOperationsFacet';
import { FacetRegistry } from '../src/diamond/FacetRegistry';

const platformActor: AdminActorContext = {
  actorUserId: 'user-platform',
  actorTenantId: 'tenant-quantum',
  role: TenantMembershipRole.PLATFORM_ADMIN,
  reason: 'phase 4 tenant operation',
  correlationId: 'corr-tenant-1',
};

const tenantAdminActor: AdminActorContext = {
  actorUserId: 'user-tenant-admin',
  actorTenantId: 'tenant-customer',
  tenantId: 'tenant-customer',
  role: TenantMembershipRole.TENANT_ADMIN,
  reason: 'tenant-local operation',
};

describe('AdminTenantOperationsFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (callback) => callback({
      tenant: mockTenant,
      tenantCommercialProfile: mockTenantCommercialProfile,
      adminAuditLog: mockAdminAuditLog,
      asset: mockAsset,
      eventLog: mockEventLog,
    }));
    mockAsset.upsert.mockResolvedValue({
      id: 'asset-tenant-profile',
      tenantId: 'tenant-b2b',
      externalId: 'tenant-profile:tenant-b2b',
      publicUrl: 'https://api.domain.com/v1/public/asset/asset-tenant-profile',
      status: 'ACTIVE',
      createdAt: new Date('2026-05-17T00:00:00.000Z'),
      updatedAt: new Date('2026-05-17T00:00:00.000Z'),
    });
    mockEventLog.create.mockResolvedValue({
      id: 'event-tenant-profile',
      status: 'APPROVED',
      dltTxId: null,
      signatureHash: 'hash-profile',
      createdAt: new Date('2026-05-17T12:01:00.000Z'),
      updatedAt: new Date('2026-05-17T12:01:00.000Z'),
    });
    mockEventLog.findFirst.mockResolvedValue(null);
    mockProcessQueue.mockResolvedValue({ processed: 0, items: [] });
  });

  it('creates a draft tenant with normalized commercial profile and admin audit', async () => {
    mockTenant.findUnique.mockResolvedValue(null);
    mockTenant.create.mockResolvedValue({
      id: 'tenant-b2b',
      name: 'Cliente B2B',
      slug: 'cliente-b2b',
      contactEmail: 'ops@cliente.com',
      planTier: PlanTier.PROFESSIONAL,
      status: TenantStatus.DRAFT,
      isActive: false,
    });
    mockTenantCommercialProfile.create.mockResolvedValue({
      id: 'profile-b2b',
      tenantId: 'tenant-b2b',
      legalName: 'Cliente B2B Ltda',
      taxId: '12345678000199',
    });

    const result = await AdminTenantOperationsFacet.createTenant(platformActor, {
      name: 'Cliente B2B',
      slug: 'Cliente-B2B',
      contactEmail: 'OPS@Cliente.com',
      planTier: PlanTier.PROFESSIONAL,
      commercialProfile: {
        legalName: 'Cliente B2B Ltda',
        taxId: '12.345.678/0001-99',
        contactEmail: 'COMERCIAL@Cliente.com',
      },
      reason: 'cadastrar cliente b2b aprovado',
    });

    expect(result).toMatchObject({
      id: 'tenant-b2b',
      slug: 'cliente-b2b',
      status: TenantStatus.DRAFT,
      isActive: false,
      commercialProfile: {
        taxId: '12345678000199',
      },
    });
    expect(mockTenant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        slug: 'cliente-b2b',
        contactEmail: 'ops@cliente.com',
        status: TenantStatus.DRAFT,
        isActive: false,
      }),
    }));
    expect(mockTenantCommercialProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        taxId: '12345678000199',
        contactEmail: 'comercial@cliente.com',
      }),
    }));
    expect(mockAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        actorUserId: 'user-platform',
        actorTenantId: 'tenant-quantum',
        action: 'TENANT_CREATED',
        reason: 'cadastrar cliente b2b aprovado',
      }),
    }));
  });

  it('anchors tenant profile edits through a canonical profile asset event', async () => {
    mockTenant.findUnique
      .mockResolvedValueOnce({ id: 'tenant-b2b' })
      .mockResolvedValueOnce({
        id: 'tenant-b2b',
        name: 'Cliente B2B Atualizado',
        slug: 'cliente-b2b',
        contactEmail: 'ops@cliente.com',
        planTier: PlanTier.ENTERPRISE,
        status: TenantStatus.ACTIVE,
        isActive: true,
        commercialProfile: {
          id: 'profile-b2b',
          tenantId: 'tenant-b2b',
          legalName: 'Cliente B2B Atualizado Ltda',
          taxId: '12345678000199',
          contactEmail: 'comercial@cliente.com',
        },
        _count: { apiKeys: 1, assets: 2, tenantUsers: 3 },
      });
    mockTenant.update.mockResolvedValue({
      id: 'tenant-b2b',
      name: 'Cliente B2B Atualizado',
      slug: 'cliente-b2b',
      contactEmail: 'ops@cliente.com',
      planTier: PlanTier.ENTERPRISE,
      status: TenantStatus.ACTIVE,
      isActive: true,
    });
    mockTenantCommercialProfile.upsert.mockResolvedValue({
      id: 'profile-b2b',
      tenantId: 'tenant-b2b',
      legalName: 'Cliente B2B Atualizado Ltda',
      taxId: '12345678000199',
      contactEmail: 'comercial@cliente.com',
      contactPhone: '+55 11 99999-0000',
      billingOwner: 'Financeiro',
      commercialPlan: 'Enterprise',
      limits: {},
      whiteLabel: {},
      internalNotes: 'Contrato revisado',
      updatedAt: new Date('2026-05-17T12:00:00.000Z'),
    });

    const result = await AdminTenantOperationsFacet.updateCommercialProfile(
      platformActor,
      'tenant-b2b',
      {
        name: 'Cliente B2B Atualizado',
        contactEmail: 'OPS@Cliente.com',
        planTier: PlanTier.ENTERPRISE,
        commercialProfile: {
          legalName: 'Cliente B2B Atualizado Ltda',
          taxId: '12.345.678/0001-99',
          contactEmail: 'COMERCIAL@Cliente.com',
          contactPhone: '+55 11 99999-0000',
          billingOwner: 'Financeiro',
          commercialPlan: 'Enterprise',
          internalNotes: 'Contrato revisado',
        },
        reason: 'atualizar dados societarios e comerciais',
      }
    );

    expect(mockAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId_externalId: {
          tenantId: 'tenant-b2b',
          externalId: 'tenant-profile:tenant-b2b',
        },
      },
      create: expect.objectContaining({
        tenantId: 'tenant-b2b',
        externalId: 'tenant-profile:tenant-b2b',
        status: 'ACTIVE',
        metadata: expect.objectContaining({
          assetKind: 'TENANT_PROFILE',
          tenant: expect.objectContaining({
            id: 'tenant-b2b',
            name: 'Cliente B2B Atualizado',
            slug: 'cliente-b2b',
          }),
          commercialProfile: expect.objectContaining({
            legalName: 'Cliente B2B Atualizado Ltda',
            taxId: '12345678000199',
            contactEmail: 'comercial@cliente.com',
          }),
        }),
        publicDataKeys: ['assetKind', 'tenant'],
      }),
      update: expect.objectContaining({
        metadata: expect.objectContaining({
          assetKind: 'TENANT_PROFILE',
        }),
        publicDataKeys: ['assetKind', 'tenant'],
      }),
    }));
    expect(mockEventLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assetId: 'asset-tenant-profile',
        tenantId: 'tenant-b2b',
        origin: 'SYSTEM_TENANT_PROFILE',
        issuerId: 'user-platform',
        status: 'APPROVED',
        payload: expect.objectContaining({
          eventType: 'TENANT_PROFILE_UPDATED',
          schemaVersion: 1,
          tenantId: 'tenant-b2b',
          profileAssetId: 'asset-tenant-profile',
          updatedByActorId: 'user-platform',
        }),
        signatureHash: expect.any(String),
        dltTxId: null,
      }),
    }));
    expect(mockProcessQueue).toHaveBeenCalledWith({ tenantId: 'tenant-b2b' });
    expect(result).toMatchObject({
      id: 'tenant-b2b',
      profileAsset: {
        id: 'asset-tenant-profile',
        externalId: 'tenant-profile:tenant-b2b',
        lastAnchorEvent: {
          id: 'event-tenant-profile',
          status: 'APPROVED',
          dltTxId: null,
        },
      },
    });
  });

  it('transitions tenant status through review, active, suspended and archived with audit', async () => {
    mockTenant.findUnique.mockResolvedValue({ id: 'tenant-b2b' });
    mockTenant.update.mockImplementation(async ({ data }) => ({
      id: 'tenant-b2b',
      slug: 'tenant-b2b',
      ...data,
      commercialProfile: null,
      _count: { apiKeys: 0, assets: 0, tenantUsers: 0 },
    }));

    await AdminTenantOperationsFacet.submitForReview(platformActor, 'tenant-b2b', {
      reason: 'perfil completo para revisao',
    });
    await AdminTenantOperationsFacet.activateTenant(platformActor, 'tenant-b2b', {
      reason: 'contrato validado',
    });
    await AdminTenantOperationsFacet.suspendTenant(platformActor, 'tenant-b2b', {
      reason: 'inadimplencia operacional',
    });
    await AdminTenantOperationsFacet.archiveTenant(platformActor, 'tenant-b2b', {
      reason: 'encerramento confirmado',
    });

    expect(mockTenant.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        status: TenantStatus.PENDING_REVIEW,
        isActive: false,
        statusReason: 'perfil completo para revisao',
      }),
    }));
    expect(mockTenant.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: TenantStatus.ACTIVE,
        isActive: true,
        statusReason: 'contrato validado',
        activatedAt: expect.any(Date),
      }),
    }));
    expect(mockTenant.update).toHaveBeenNthCalledWith(3, expect.objectContaining({
      data: expect.objectContaining({
        status: TenantStatus.SUSPENDED,
        isActive: false,
        suspendedAt: expect.any(Date),
      }),
    }));
    expect(mockTenant.update).toHaveBeenNthCalledWith(4, expect.objectContaining({
      data: expect.objectContaining({
        status: TenantStatus.ARCHIVED,
        isActive: false,
        archivedAt: expect.any(Date),
      }),
    }));
    expect(mockAdminAuditLog.create).toHaveBeenCalledTimes(4);
    expect(mockAdminAuditLog.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        action: 'TENANT_ACTIVATED',
        reason: 'contrato validado',
      }),
    }));
  });

  it('requires a reason for privileged tenant mutations', async () => {
    await expect(
      AdminTenantOperationsFacet.createTenant(
        { ...platformActor, reason: undefined },
        {
          name: 'Sem Justificativa',
          slug: 'sem-justificativa',
          contactEmail: 'ops@semjustificativa.com',
        }
      )
    ).rejects.toMatchObject({ code: 'ADMIN_REASON_REQUIRED' });

    expect(mockTenant.create).not.toHaveBeenCalled();
    expect(mockAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('denies Tenant Admin cross-tenant lifecycle operations', async () => {
    await expect(
      AdminTenantOperationsFacet.listTenants(tenantAdminActor, {})
    ).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });

    await expect(
      AdminTenantOperationsFacet.activateTenant(tenantAdminActor, 'tenant-b2b', {
        reason: 'tentativa cross-tenant',
      })
    ).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });

    expect(mockTenant.findMany).not.toHaveBeenCalled();
    expect(mockTenant.update).not.toHaveBeenCalled();
  });

  it('keeps platform admin tenants on REST routes instead of public Diamond selectors', () => {
    expect(FacetRegistry['admin.tenants.create']).toBeUndefined();
    expect(FacetRegistry['admin.tenants.activate']).toBeUndefined();
  });
});
