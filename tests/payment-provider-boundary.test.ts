import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentEventStatus,
  PaymentStatus,
  PurchaseOrderStatus,
  PurchaseOrderType,
  TenantMembershipRole,
} from '@prisma/client';
import { AdminActorContext } from '../src/types';

const {
  mockTenant,
  mockPurchaseOrder,
  mockPaymentIntent,
  mockPaymentEvent,
  mockCreditLedgerEntry,
  mockTransaction,
} = vi.hoisted(() => {
  const mockTenant = {
    findUnique: vi.fn(),
  };
  const mockPurchaseOrder = {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  };
  const mockPaymentIntent = {
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockPaymentEvent = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  };
  const mockCreditLedgerEntry = {
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockTransaction = vi.fn(async (callback) => callback({
    tenant: mockTenant,
    purchaseOrder: mockPurchaseOrder,
    paymentIntent: mockPaymentIntent,
    paymentEvent: mockPaymentEvent,
    creditLedgerEntry: mockCreditLedgerEntry,
  }));

  return {
    mockTenant,
    mockPurchaseOrder,
    mockPaymentIntent,
    mockPaymentEvent,
    mockCreditLedgerEntry,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    tenant: mockTenant,
    purchaseOrder: mockPurchaseOrder,
    paymentIntent: mockPaymentIntent,
    paymentEvent: mockPaymentEvent,
    creditLedgerEntry: mockCreditLedgerEntry,
    $transaction: mockTransaction,
  },
}));

import {
  FakeLocalReceivablesProvider,
  ReceivablesProviderFacet,
} from '../src/services/core-facets/ReceivablesProviderFacet';

const platformActor: AdminActorContext = {
  actorUserId: 'user-platform',
  actorTenantId: 'tenant-quantum',
  role: TenantMembershipRole.PLATFORM_ADMIN,
  reason: 'compra operacional de créditos',
  correlationId: 'corr-payment-1',
};

function purchaseOrderFixture(overrides = {}) {
  return {
    id: 'purchase-order-1',
    tenantId: 'tenant-b2b',
    userId: null,
    type: PurchaseOrderType.CREDIT_PACKAGE,
    status: PurchaseOrderStatus.PENDING_PAYMENT,
    sku: 'credits-100',
    quantity: 100,
    amount: '100.00',
    currency: 'BRL',
    provider: 'LOCAL_FAKE',
    providerOrderId: null,
    metadata: {},
    createdByActorId: 'user-platform',
    reason: 'compra aprovada',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function paymentIntentFixture(overrides = {}) {
  return {
    id: 'payment-intent-1',
    tenantId: 'tenant-b2b',
    purchaseOrderId: 'purchase-order-1',
    provider: 'LOCAL_FAKE',
    providerIntentId: 'local_purchase-order-1',
    amount: '100.00',
    currency: 'BRL',
    status: PaymentStatus.PENDING,
    paymentUrl: 'https://payments.local/checkout/purchase-order-1',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function paymentEventFixture(overrides = {}) {
  return {
    id: 'payment-event-1',
    tenantId: 'tenant-b2b',
    purchaseOrderId: 'purchase-order-1',
    paymentIntentId: 'payment-intent-1',
    provider: 'LOCAL_FAKE',
    providerEventId: 'provider-event-1',
    eventType: 'payment.updated',
    status: PaymentEventStatus.CONFIRMED,
    payloadHash: 'payload-hash',
    sanitizedPayload: {},
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    processedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ReceivablesProviderFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenant.findUnique.mockResolvedValue({ id: 'tenant-b2b' });
    mockPurchaseOrder.create.mockResolvedValue(purchaseOrderFixture());
    mockPurchaseOrder.findUnique.mockResolvedValue(purchaseOrderFixture());
    mockPurchaseOrder.update.mockResolvedValue(purchaseOrderFixture({ status: PurchaseOrderStatus.PAID }));
    mockPaymentIntent.create.mockResolvedValue(paymentIntentFixture());
    mockPaymentIntent.update.mockResolvedValue(paymentIntentFixture({ status: PaymentStatus.CONFIRMED }));
    mockPaymentEvent.findUnique.mockResolvedValue(null);
    mockPaymentEvent.create.mockResolvedValue(paymentEventFixture());
    mockCreditLedgerEntry.findUnique.mockResolvedValue(null);
    mockCreditLedgerEntry.create.mockResolvedValue({
      id: 'credit-ledger-purchased-1',
      tenantId: 'tenant-b2b',
      amount: 100,
      availableDelta: 100,
      reservedDelta: 0,
    });
    mockTransaction.mockImplementation(async (callback) => callback({
      tenant: mockTenant,
      purchaseOrder: mockPurchaseOrder,
      paymentIntent: mockPaymentIntent,
      paymentEvent: mockPaymentEvent,
      creditLedgerEntry: mockCreditLedgerEntry,
    }));
  });

  it('cria PurchaseOrder e PaymentIntent sem acoplar Transfero como contrato final', async () => {
    const result = await ReceivablesProviderFacet.createCreditPurchaseIntent(
      platformActor,
      'tenant-b2b',
      {
        credits: 100,
        amount: '100.00',
        currency: 'brl',
        sku: 'credits-100',
        reason: 'compra aprovada',
      }
    );

    expect(result).toMatchObject({
      purchaseOrder: {
        id: 'purchase-order-1',
        status: PurchaseOrderStatus.PENDING_PAYMENT,
      },
      paymentIntent: {
        provider: 'LOCAL_FAKE',
        status: PaymentStatus.PENDING,
      },
    });
    expect(mockPurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        type: PurchaseOrderType.CREDIT_PACKAGE,
        status: PurchaseOrderStatus.PENDING_PAYMENT,
        quantity: 100,
        currency: 'BRL',
      }),
    }));
    expect(JSON.stringify(mockPaymentIntent.create.mock.calls)).toContain('Transfero TBD');
  });

  it('confirma webhook validado e cria crédito PURCHASED uma única vez', async () => {
    const payload = {
      eventId: 'provider-event-1',
      tenantId: 'tenant-b2b',
      purchaseOrderId: 'purchase-order-1',
      paymentIntentId: 'payment-intent-1',
      status: 'CONFIRMED',
      amount: '100.00',
      currency: 'BRL',
    };
    const signature = FakeLocalReceivablesProvider.signPayload(payload);

    const result = await ReceivablesProviderFacet.recordPaymentWebhook({
      provider: 'LOCAL_FAKE',
      headers: { 'x-qc-provider-signature': signature },
      body: payload,
    });

    expect(result).toMatchObject({ deduped: false, credited: true });
    expect(mockPaymentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        provider: 'LOCAL_FAKE',
        providerEventId: 'provider-event-1',
        status: PaymentEventStatus.CONFIRMED,
      }),
    }));
    expect(mockPurchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'purchase-order-1' },
      data: { status: PurchaseOrderStatus.PAID },
    }));
    expect(mockCreditLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-b2b',
        purchaseOrderId: 'purchase-order-1',
        entryType: 'PURCHASED',
        amount: 100,
        availableDelta: 100,
        idempotencyKey: 'payment-event:LOCAL_FAKE:provider-event-1',
      }),
    }));
  });

  it('deduplica provider event repetido antes de creditar', async () => {
    const existingEvent = paymentEventFixture();
    mockPaymentEvent.findUnique.mockResolvedValue(existingEvent);
    const payload = {
      eventId: 'provider-event-1',
      tenantId: 'tenant-b2b',
      status: 'CONFIRMED',
    };

    const result = await ReceivablesProviderFacet.recordPaymentWebhook({
      provider: 'LOCAL_FAKE',
      headers: {
        'x-qc-provider-signature': FakeLocalReceivablesProvider.signPayload(payload),
      },
      body: payload,
    });

    expect(result).toMatchObject({
      event: existingEvent,
      deduped: true,
      credited: false,
    });
    expect(mockPaymentEvent.create).not.toHaveBeenCalled();
    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('não credita webhook com assinatura inválida', async () => {
    await expect(
      ReceivablesProviderFacet.recordPaymentWebhook({
        provider: 'LOCAL_FAKE',
        headers: { 'x-qc-provider-signature': 'invalid' },
        body: {
          eventId: 'provider-event-1',
          tenantId: 'tenant-b2b',
          status: 'CONFIRMED',
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_WEBHOOK_SIGNATURE' });

    expect(mockPaymentEvent.create).not.toHaveBeenCalled();
    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
  });
});
