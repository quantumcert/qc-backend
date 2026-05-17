import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QTagFulfillmentStatus,
  QTagLedgerEntryType,
  TenantMembershipRole,
} from '@prisma/client';
import { AdminActorContext } from '../src/types';

const {
  mockTenant,
  mockAsset,
  mockQTagLedgerEntry,
  mockQTagFulfillmentOrder,
  mockAdminAuditLog,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTenant = { findUnique: vi.fn() };
  const mockAsset = { findFirst: vi.fn() };
  const mockQTagLedgerEntry = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  };
  const mockQTagFulfillmentOrder = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockAdminAuditLog = { create: vi.fn() };
  const mockTransaction = vi.fn(async (callback) => callback({
    tenant: mockTenant,
    asset: mockAsset,
    qTagLedgerEntry: mockQTagLedgerEntry,
    qTagFulfillmentOrder: mockQTagFulfillmentOrder,
    adminAuditLog: mockAdminAuditLog,
  }));

  return {
    mockTenant,
    mockAsset,
    mockQTagLedgerEntry,
    mockQTagFulfillmentOrder,
    mockAdminAuditLog,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    asset: mockAsset,
    qTagLedgerEntry: mockQTagLedgerEntry,
    qTagFulfillmentOrder: mockQTagFulfillmentOrder,
    adminAuditLog: mockAdminAuditLog,
    $transaction: mockTransaction,
  },
}));

import { QTagFulfillmentFacet } from '../src/services/core-facets/QTagFulfillmentFacet';

const platformActor: AdminActorContext = {
  actorUserId: 'user-platform',
  actorTenantId: 'tenant-quantum',
  role: TenantMembershipRole.PLATFORM_ADMIN,
  reason: 'gestão operacional de QTAG',
  correlationId: 'corr-qtag-1',
};

function qtagLedgerFixture(overrides = {}) {
  return {
    id: 'qtag-ledger-1',
    tenantId: 'tenant-b2b',
    userId: null,
    purchaseOrderId: null,
    fulfillmentOrderId: null,
    entryType: QTagLedgerEntryType.GRANTED,
    quantity: 3,
    availableDelta: 3,
    reservedDelta: 0,
    referenceType: null,
    referenceId: null,
    idempotencyKey: null,
    actorUserId: 'user-platform',
    reason: 'saldo inicial de QTAG',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fulfillmentOrderFixture(overrides = {}) {
  return {
    id: 'qtag-order-1',
    tenantId: 'tenant-b2b',
    userId: null,
    assetId: 'asset-1',
    status: QTagFulfillmentStatus.REQUESTED,
    sku: 'qtag-life',
    shippingRecipient: {},
    trackingCode: null,
    carrier: null,
    notes: 'ativar tag no ativo',
    attempts: 0,
    lastError: null,
    claimedByActorId: 'user-platform',
    dispatchedAt: null,
    deliveredAt: null,
    activatedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('QTagFulfillmentFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenant.findUnique.mockResolvedValue({ id: 'tenant-b2b' });
    mockAsset.findFirst.mockResolvedValue({ id: 'asset-1', tenantId: 'tenant-b2b', deviceId: null });
    mockQTagLedgerEntry.findMany.mockResolvedValue([]);
    mockQTagLedgerEntry.findUnique.mockResolvedValue(null);
    mockQTagLedgerEntry.count.mockResolvedValue(0);
    mockQTagLedgerEntry.create.mockResolvedValue(qtagLedgerFixture());
    mockQTagFulfillmentOrder.findFirst.mockResolvedValue(null);
    mockQTagFulfillmentOrder.findUnique.mockResolvedValue(fulfillmentOrderFixture());
    mockQTagFulfillmentOrder.create.mockResolvedValue(fulfillmentOrderFixture());
    mockQTagFulfillmentOrder.update.mockResolvedValue(fulfillmentOrderFixture({ status: QTagFulfillmentStatus.CANCELLED }));
    mockTransaction.mockImplementation(async (callback) => callback({
      tenant: mockTenant,
      asset: mockAsset,
      qTagLedgerEntry: mockQTagLedgerEntry,
      qTagFulfillmentOrder: mockQTagFulfillmentOrder,
      adminAuditLog: mockAdminAuditLog,
    }));
  });

  it('concede saldo QTAG por ledger separado de créditos da aplicação', async () => {
    mockQTagLedgerEntry.create.mockResolvedValue(qtagLedgerFixture({
      entryType: QTagLedgerEntryType.GRANTED,
      quantity: 5,
      availableDelta: 5,
      idempotencyKey: 'grant-qtag-1',
    }));

    const result = await QTagFulfillmentFacet.grantQTags(platformActor, 'tenant-b2b', {
      quantity: 5,
      reason: 'compra manual de QTAG aprovada',
      idempotencyKey: 'grant-qtag-1',
    });

    expect(result).toMatchObject({
      entryType: QTagLedgerEntryType.GRANTED,
      quantity: 5,
      availableDelta: 5,
    });
    expect(mockQTagLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        entryType: QTagLedgerEntryType.GRANTED,
        quantity: 5,
        availableDelta: 5,
        reservedDelta: 0,
      }),
    }));
    expect(mockAdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'QTAG_GRANTED',
        resourceType: 'QTagFulfillmentOrder',
        reason: 'compra manual de QTAG aprovada',
      }),
    }));
  });

  it('reserva QTAG apenas para Asset existente do mesmo tenant e cria fulfillment order', async () => {
    mockQTagLedgerEntry.findMany.mockResolvedValue([
      qtagLedgerFixture({ entryType: QTagLedgerEntryType.GRANTED, quantity: 2, availableDelta: 2 }),
    ]);
    mockQTagLedgerEntry.create.mockResolvedValue(qtagLedgerFixture({
      entryType: QTagLedgerEntryType.RESERVED,
      quantity: 1,
      availableDelta: -1,
      reservedDelta: 1,
      fulfillmentOrderId: 'qtag-order-1',
      idempotencyKey: 'reserve-asset-1',
    }));

    const result = await QTagFulfillmentFacet.reserveForAsset(platformActor, 'tenant-b2b', {
      assetId: 'asset-1',
      sku: 'qtag-life',
      reason: 'cliente selecionou ativo para TAG',
      idempotencyKey: 'reserve-asset-1',
    });

    expect(result).toMatchObject({
      order: { id: 'qtag-order-1', status: QTagFulfillmentStatus.REQUESTED },
      ledgerEntry: {
        entryType: QTagLedgerEntryType.RESERVED,
        availableDelta: -1,
        reservedDelta: 1,
      },
      deduped: false,
    });
    expect(mockQTagFulfillmentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        assetId: 'asset-1',
        status: QTagFulfillmentStatus.REQUESTED,
      }),
    }));
  });

  it('bloqueia double reserve para Asset com order ativa', async () => {
    mockQTagFulfillmentOrder.findFirst.mockResolvedValue(fulfillmentOrderFixture({
      status: QTagFulfillmentStatus.READY_FOR_ENCODING,
    }));

    await expect(
      QTagFulfillmentFacet.reserveForAsset(platformActor, 'tenant-b2b', {
        assetId: 'asset-1',
        reason: 'segunda tentativa',
      })
    ).rejects.toMatchObject({ code: 'QTAG_ALREADY_RESERVED' });

    expect(mockQTagLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('libera reserva antes da ativação por ledger auditável', async () => {
    mockQTagFulfillmentOrder.findFirst.mockResolvedValue(fulfillmentOrderFixture({
      status: QTagFulfillmentStatus.ENCODING_FAILED,
    }));
    mockQTagLedgerEntry.findMany.mockResolvedValue([
      qtagLedgerFixture({
        entryType: QTagLedgerEntryType.RESERVED,
        quantity: 1,
        availableDelta: -1,
        reservedDelta: 1,
      }),
    ]);
    mockQTagLedgerEntry.create.mockResolvedValue(qtagLedgerFixture({
      entryType: QTagLedgerEntryType.RELEASED,
      quantity: 1,
      availableDelta: 1,
      reservedDelta: -1,
      idempotencyKey: 'qtag-release:qtag-order-1',
    }));

    const result = await QTagFulfillmentFacet.releaseReservation(
      platformActor,
      'tenant-b2b',
      'qtag-order-1',
      { reason: 'falha de gravação antes da ativação' }
    );

    expect(result).toMatchObject({
      ledgerEntry: {
        entryType: QTagLedgerEntryType.RELEASED,
        availableDelta: 1,
        reservedDelta: -1,
      },
    });
    expect(mockQTagFulfillmentOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'qtag-order-1' },
      data: expect.objectContaining({
        status: QTagFulfillmentStatus.CANCELLED,
        cancellationReason: 'falha de gravação antes da ativação',
      }),
    }));
  });

  it('nega Asset de outro tenant ou já tagueado', async () => {
    mockAsset.findFirst.mockResolvedValueOnce(null);
    await expect(
      QTagFulfillmentFacet.reserveForAsset(platformActor, 'tenant-b2b', {
        assetId: 'asset-other',
        reason: 'cross tenant',
      })
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    mockAsset.findFirst.mockResolvedValueOnce({ id: 'asset-1', tenantId: 'tenant-b2b', deviceId: 'device-1' });
    await expect(
      QTagFulfillmentFacet.reserveForAsset(platformActor, 'tenant-b2b', {
        assetId: 'asset-1',
        reason: 'ativo já possui tag',
      })
    ).rejects.toMatchObject({ code: 'ASSET_ALREADY_TAGGED' });
  });
});
