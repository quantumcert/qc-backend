import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreditLedgerEntryType,
  TenantMembershipRole,
} from '@prisma/client';
import { AdminActorContext } from '../src/types';

const {
  mockTenant,
  mockCreditLedgerEntry,
  mockAdminAuditLog,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTenant = {
    findUnique: vi.fn(),
  };
  const mockCreditLedgerEntry = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  };
  const mockAdminAuditLog = {
    create: vi.fn(),
  };
  const mockTransaction = vi.fn(async (callback) => callback({
    tenant: mockTenant,
    creditLedgerEntry: mockCreditLedgerEntry,
    adminAuditLog: mockAdminAuditLog,
  }));

  return {
    mockTenant,
    mockCreditLedgerEntry,
    mockAdminAuditLog,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    creditLedgerEntry: mockCreditLedgerEntry,
    adminAuditLog: mockAdminAuditLog,
    $transaction: mockTransaction,
  },
}));

import { CreditLedgerFacet } from '../src/services/core-facets/CreditLedgerFacet';

const platformActor: AdminActorContext = {
  actorUserId: 'user-platform',
  actorTenantId: 'tenant-quantum',
  role: TenantMembershipRole.PLATFORM_ADMIN,
  reason: 'gestão operacional de créditos',
  correlationId: 'corr-credit-1',
};

const tenantAdminActor: AdminActorContext = {
  actorUserId: 'user-tenant-admin',
  actorTenantId: 'tenant-b2b',
  tenantId: 'tenant-b2b',
  role: TenantMembershipRole.TENANT_ADMIN,
  reason: 'tentativa tenant admin',
};

function ledgerEntryFixture(overrides = {}) {
  return {
    id: 'credit-ledger-1',
    tenantId: 'tenant-b2b',
    userId: null,
    purchaseOrderId: null,
    entryType: CreditLedgerEntryType.GRANTED,
    amount: 10,
    availableDelta: 10,
    reservedDelta: 0,
    referenceType: null,
    referenceId: null,
    idempotencyKey: null,
    actorUserId: 'user-platform',
    reason: 'crédito comercial aprovado',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('CreditLedgerFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenant.findUnique.mockResolvedValue({ id: 'tenant-b2b' });
    mockCreditLedgerEntry.findMany.mockResolvedValue([]);
    mockCreditLedgerEntry.findUnique.mockResolvedValue(null);
    mockCreditLedgerEntry.count.mockResolvedValue(0);
    mockCreditLedgerEntry.create.mockResolvedValue(ledgerEntryFixture());
    mockTransaction.mockImplementation(async (callback) => callback({
      tenant: mockTenant,
      creditLedgerEntry: mockCreditLedgerEntry,
      adminAuditLog: mockAdminAuditLog,
    }));
  });

  it('concede créditos por ledger imutável com motivo e audit admin', async () => {
    mockCreditLedgerEntry.create.mockResolvedValue(ledgerEntryFixture({
      entryType: CreditLedgerEntryType.GRANTED,
      amount: 25,
      availableDelta: 25,
      reason: 'concessão comercial aprovada',
    }));

    const result = await CreditLedgerFacet.grantCredits(platformActor, 'tenant-b2b', {
      amount: 25,
      reason: 'concessão comercial aprovada',
      idempotencyKey: 'grant-tenant-b2b-001',
    });

    expect(result).toMatchObject({
      tenantId: 'tenant-b2b',
      entryType: CreditLedgerEntryType.GRANTED,
      amount: 25,
      availableDelta: 25,
    });
    expect(mockCreditLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        entryType: CreditLedgerEntryType.GRANTED,
        amount: 25,
        availableDelta: 25,
        idempotencyKey: 'grant-tenant-b2b-001',
        actorUserId: 'user-platform',
        reason: 'concessão comercial aprovada',
      }),
    }));
    expect(mockAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        actorUserId: 'user-platform',
        actorTenantId: 'tenant-quantum',
        action: 'CREDIT_GRANTED',
        resourceType: 'CreditLedgerEntry',
        reason: 'concessão comercial aprovada',
      }),
    }));
  });

  it('deriva saldo disponível e reservado somente das entradas de ledger', async () => {
    mockCreditLedgerEntry.findMany.mockResolvedValue([
      ledgerEntryFixture({ entryType: CreditLedgerEntryType.PURCHASED, amount: 10, availableDelta: 10, reservedDelta: 0 }),
      ledgerEntryFixture({ entryType: CreditLedgerEntryType.RESERVED, amount: 3, availableDelta: -3, reservedDelta: 3 }),
      ledgerEntryFixture({ entryType: CreditLedgerEntryType.CONSUMED, amount: 2, availableDelta: 0, reservedDelta: -2 }),
      ledgerEntryFixture({ entryType: CreditLedgerEntryType.RELEASED, amount: 1, availableDelta: 1, reservedDelta: -1 }),
    ]);

    const balance = await CreditLedgerFacet.getBalance(platformActor, 'tenant-b2b');

    expect(balance).toMatchObject({
      tenantId: 'tenant-b2b',
      available: 8,
      reserved: 0,
      total: 8,
      purchased: 10,
      consumed: 2,
    });
    expect(mockCreditLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-b2b' },
    }));
  });

  it('permite Tenant Admin consultar apenas o saldo do próprio tenant', async () => {
    mockCreditLedgerEntry.findMany.mockResolvedValue([
      ledgerEntryFixture({ entryType: CreditLedgerEntryType.GRANTED, amount: 7, availableDelta: 7 }),
    ]);

    const balance = await CreditLedgerFacet.getBalance(tenantAdminActor, 'tenant-b2b');

    expect(balance).toMatchObject({
      tenantId: 'tenant-b2b',
      available: 7,
      total: 7,
    });

    await expect(
      CreditLedgerFacet.getBalance(tenantAdminActor, 'tenant-other')
    ).rejects.toMatchObject({ code: 'TENANT_SCOPE_FORBIDDEN' });
  });

  it('reserva, consome e libera créditos com idempotência operacional', async () => {
    mockCreditLedgerEntry.findMany
      .mockResolvedValueOnce([
        ledgerEntryFixture({ entryType: CreditLedgerEntryType.GRANTED, amount: 10, availableDelta: 10 }),
      ])
      .mockResolvedValueOnce([
        ledgerEntryFixture({ entryType: CreditLedgerEntryType.RESERVED, amount: 4, availableDelta: -4, reservedDelta: 4 }),
      ])
      .mockResolvedValueOnce([
        ledgerEntryFixture({ entryType: CreditLedgerEntryType.RESERVED, amount: 4, availableDelta: -4, reservedDelta: 4 }),
      ]);
    mockCreditLedgerEntry.create
      .mockResolvedValueOnce(ledgerEntryFixture({
        entryType: CreditLedgerEntryType.RESERVED,
        amount: 4,
        availableDelta: -4,
        reservedDelta: 4,
        idempotencyKey: 'reserve-activation-1',
      }))
      .mockResolvedValueOnce(ledgerEntryFixture({
        entryType: CreditLedgerEntryType.CONSUMED,
        amount: 2,
        availableDelta: 0,
        reservedDelta: -2,
        idempotencyKey: 'consume-activation-1',
      }))
      .mockResolvedValueOnce(ledgerEntryFixture({
        entryType: CreditLedgerEntryType.RELEASED,
        amount: 2,
        availableDelta: 2,
        reservedDelta: -2,
        idempotencyKey: 'release-activation-1',
      }));

    await CreditLedgerFacet.reserveCredits({
      tenantId: 'tenant-b2b',
      amount: 4,
      idempotencyKey: 'reserve-activation-1',
      referenceType: 'activation',
      referenceId: 'activation-1',
    });
    await CreditLedgerFacet.consumeReservedCredits({
      tenantId: 'tenant-b2b',
      amount: 2,
      idempotencyKey: 'consume-activation-1',
      referenceType: 'activation',
      referenceId: 'activation-1',
    });
    await CreditLedgerFacet.releaseReservedCredits({
      tenantId: 'tenant-b2b',
      amount: 2,
      idempotencyKey: 'release-activation-1',
      referenceType: 'activation',
      referenceId: 'activation-1',
    });

    expect(mockCreditLedgerEntry.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        entryType: CreditLedgerEntryType.RESERVED,
        availableDelta: -4,
        reservedDelta: 4,
      }),
    }));
    expect(mockCreditLedgerEntry.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        entryType: CreditLedgerEntryType.CONSUMED,
        availableDelta: 0,
        reservedDelta: -2,
      }),
    }));
    expect(mockCreditLedgerEntry.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
      data: expect.objectContaining({
        entryType: CreditLedgerEntryType.RELEASED,
        availableDelta: 2,
        reservedDelta: -2,
      }),
    }));

    mockCreditLedgerEntry.findUnique.mockResolvedValueOnce(ledgerEntryFixture({
      entryType: CreditLedgerEntryType.RESERVED,
      idempotencyKey: 'reserve-activation-1',
    }));
    mockCreditLedgerEntry.create.mockClear();

    await CreditLedgerFacet.reserveCredits({
      tenantId: 'tenant-b2b',
      amount: 4,
      idempotencyKey: 'reserve-activation-1',
    });

    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('bloqueia ajuste admin sem motivo e actor que não seja Platform Admin', async () => {
    await expect(
      CreditLedgerFacet.adjustCredits(
        { ...platformActor, reason: undefined },
        'tenant-b2b',
        { delta: 5 }
      )
    ).rejects.toMatchObject({ code: 'ADMIN_REASON_REQUIRED' });

    await expect(
      CreditLedgerFacet.grantCredits(tenantAdminActor, 'tenant-b2b', {
        amount: 5,
        reason: 'tentativa fora da plataforma',
      })
    ).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });

    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
    expect(mockAdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('não permite revogar crédito acima do disponível', async () => {
    mockCreditLedgerEntry.findMany.mockResolvedValue([
      ledgerEntryFixture({ entryType: CreditLedgerEntryType.GRANTED, amount: 2, availableDelta: 2 }),
    ]);

    await expect(
      CreditLedgerFacet.revokeCredits(platformActor, 'tenant-b2b', {
        amount: 3,
        reason: 'estorno maior que saldo',
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });

    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
  });
});
