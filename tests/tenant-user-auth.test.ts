import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { CreditLedgerEntryType, TenantUserRole, TenantUserStatus } from '@prisma/client';

const {
  mockTenant,
  mockTenantUser,
  mockTenantUserCredential,
  mockTenantUserSession,
  mockTenantMembership,
  mockAsset,
  mockEventLog,
  mockCreditLedgerEntry,
  mockTransaction,
  mockProcessQueue,
} = vi.hoisted(() => {
  const mockTenant = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantUser = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantUserCredential = {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantUserSession = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const mockTenantMembership = {
    upsert: vi.fn(),
  };
  const mockAsset = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  const mockEventLog = {
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  const mockCreditLedgerEntry = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockProcessQueue = vi.fn();
  const mockTransaction = vi.fn(async (callback) => callback({
    tenant: mockTenant,
    tenantUser: mockTenantUser,
    tenantUserCredential: mockTenantUserCredential,
    tenantUserSession: mockTenantUserSession,
    tenantMembership: mockTenantMembership,
    asset: mockAsset,
    eventLog: mockEventLog,
    creditLedgerEntry: mockCreditLedgerEntry,
  }));

  return {
    mockTenant,
    mockTenantUser,
    mockTenantUserCredential,
    mockTenantUserSession,
    mockTenantMembership,
    mockAsset,
    mockEventLog,
    mockCreditLedgerEntry,
    mockTransaction,
    mockProcessQueue,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    tenantUser: mockTenantUser,
    tenantUserCredential: mockTenantUserCredential,
    tenantUserSession: mockTenantUserSession,
    tenantMembership: mockTenantMembership,
    asset: mockAsset,
    eventLog: mockEventLog,
    creditLedgerEntry: mockCreditLedgerEntry,
    $transaction: mockTransaction,
  },
}));

vi.mock('../src/services/AnchorQueueService', () => ({
  AnchorQueueService: {
    processQueue: mockProcessQueue,
  },
}));

import { TenantUserAuthFacet, TenantUserAuthError } from '../src/services/core-facets/TenantUserAuthFacet';

const tenant = {
  id: 'tenant-quantum',
  slug: 'quantum-cert-platform',
  activatedAt: new Date('2026-05-18T00:00:00.000Z'),
};

const tenantUser = {
  id: 'tenant-user-1',
  tenantId: tenant.id,
  email: 'user@example.com',
  phone: null,
  document: null,
  documentType: null,
  displayName: 'User Example',
  role: TenantUserRole.MEMBER,
  status: TenantUserStatus.ACTIVE,
  legacyDashboardUserId: null,
  legacyOpenId: 'user@example.com',
  guardianId: null,
  profile: {},
  metadata: {},
  memberships: [],
  dependents: [],
  externalIdentities: [],
};

describe('TenantUserAuthFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenant.findUnique.mockResolvedValue(tenant);
    mockTenant.upsert.mockResolvedValue(tenant);
    mockTenantUser.findUnique.mockResolvedValue(null);
    mockTenantUser.findFirst.mockResolvedValue(null);
    mockTenantUser.create.mockResolvedValue(tenantUser);
    mockTenantMembership.upsert.mockResolvedValue({ id: 'membership-1' });
    mockAsset.findUnique.mockResolvedValue(null);
    mockAsset.upsert.mockResolvedValue({ id: 'profile-asset', status: 'ACTIVE' });
    mockEventLog.create.mockResolvedValue({ id: 'event-profile' });
    mockEventLog.findFirst.mockResolvedValue(null);
    mockCreditLedgerEntry.findMany.mockResolvedValue([]);
    mockCreditLedgerEntry.findUnique.mockResolvedValue(null);
    mockCreditLedgerEntry.create.mockImplementation(({ data }) => Promise.resolve({
      id: 'credit-entry-1',
      ...data,
      createdAt: new Date('2026-05-21T00:00:00.000Z'),
    }));
    mockProcessQueue.mockResolvedValue({ processed: 0 });
    mockTenantUserCredential.findFirst.mockResolvedValue(null);
    mockTenantUserCredential.upsert.mockResolvedValue({
      id: 'credential-1',
      tenantUserId: tenantUser.id,
      passwordHash: '$2a$10$hash',
      failedAttempts: 0,
      lockedUntil: null,
    });
    mockTenantUserSession.create.mockResolvedValue({
      id: 'session-1',
      tenantUserId: tenantUser.id,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      tenantUser,
    });
    mockTenantUserSession.update.mockResolvedValue({
      id: 'session-1',
      revokedAt: new Date(),
    });
    mockTransaction.mockImplementation(async (callback) => callback({
      tenant: mockTenant,
      tenantUser: mockTenantUser,
      tenantUserCredential: mockTenantUserCredential,
      tenantUserSession: mockTenantUserSession,
      tenantMembership: mockTenantMembership,
      asset: mockAsset,
      eventLog: mockEventLog,
      creditLedgerEntry: mockCreditLedgerEntry,
    }));
  });

  it('registers an open account as a TenantUser with hashed credential and opaque session', async () => {
    const result = await TenantUserAuthFacet.registerOpen({
      name: 'User Example',
      email: 'USER@EXAMPLE.COM',
      password: 'correct-password',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(result.user).toMatchObject({
      id: tenantUser.id,
      email: 'user@example.com',
    });
    expect(result.sessionToken).toMatch(/^qcs_/);
    expect(mockTenantUserCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        tenantUserId: tenantUser.id,
        passwordHash: expect.stringMatching(/^\$2/),
      }),
    }));
    expect(mockTenantUserSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantUserId: tenantUser.id,
        tokenHash: expect.not.stringContaining('qcs_'),
        createdIp: '127.0.0.1',
        createdUserAgent: 'vitest',
      }),
    }));
  });

  it('grants the initial 5 registration credits on open account creation', async () => {
    await TenantUserAuthFacet.registerOpen({
      name: 'User Example',
      email: 'USER@EXAMPLE.COM',
      password: 'correct-password',
    });

    expect(mockCreditLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: tenant.id,
        userId: tenantUser.id,
        entryType: CreditLedgerEntryType.GRANTED,
        amount: 5,
        availableDelta: 5,
        reservedDelta: 0,
        idempotencyKey: `registration-bonus:${tenantUser.id}`,
        referenceType: 'REGISTRATION_BONUS',
        referenceId: tenantUser.id,
        reason: 'initial registration bonus',
        metadata: expect.objectContaining({
          source: 'open-registration',
          email: 'user@example.com',
        }),
      }),
    }));
  });

  it('logs in with the same generic invalid-credentials error for unknown email and wrong password', async () => {
    mockTenantUserCredential.findFirst.mockResolvedValue(null);

    await expect(
      TenantUserAuthFacet.login({ email: 'missing@example.com', password: 'wrong' })
    ).rejects.toBeInstanceOf(TenantUserAuthError);

    const firstError = await TenantUserAuthFacet.login({ email: 'missing@example.com', password: 'wrong' })
      .catch((error) => error as TenantUserAuthError);

    mockTenantUserCredential.findFirst.mockResolvedValue({
      id: 'credential-1',
      tenantUserId: tenantUser.id,
      passwordHash: await bcrypt.hash('correct-password', 10),
      failedAttempts: 0,
      lockedUntil: null,
      tenantUser,
    });

    const secondError = await TenantUserAuthFacet.login({ email: 'user@example.com', password: 'wrong' })
      .catch((error) => error as TenantUserAuthError);

    expect(firstError.code).toBe('INVALID_CREDENTIALS');
    expect(secondError.code).toBe('INVALID_CREDENTIALS');
    expect(firstError.message).toBe(secondError.message);
  });

  it('returns current user for a valid unexpired session and revokes logout by token hash', async () => {
    mockAsset.findUnique.mockResolvedValue({
      id: 'profile-asset',
      externalId: `tenant-user-profile:${tenantUser.id}`,
      publicUrl: 'http://localhost:3001/public/verify/profile-asset',
      status: 'ACTIVE',
      metadata: {},
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    });
    mockEventLog.findFirst.mockResolvedValue({
      id: 'event-profile',
      status: 'APPROVED',
      dltTxId: 'stellar-tx-profile',
      signatureHash: 'signature-profile',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    });
    mockTenantUserSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tenantUserId: tenantUser.id,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      tenantUser,
    });

    const current = await TenantUserAuthFacet.current('qcs_valid-token');
    expect(current).toMatchObject({
      id: tenantUser.id,
      profileAsset: {
        id: 'profile-asset',
        externalId: `tenant-user-profile:${tenantUser.id}`,
        lastAnchorEvent: {
          dltTxId: 'stellar-tx-profile',
        },
      },
    });

    await TenantUserAuthFacet.logout('qcs_valid-token');
    expect(mockTenantUserSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { tokenHash: expect.any(String) },
      data: expect.objectContaining({ revokedAt: expect.any(Date) }),
    }));
  });
});
