import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditLedgerEntryType } from '@prisma/client';

const {
  mockCreditLedgerEntry,
  mockTransaction,
} = vi.hoisted(() => {
  const mockCreditLedgerEntry = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockTransaction = vi.fn(async (callback) => callback({
    creditLedgerEntry: mockCreditLedgerEntry,
  }));

  return {
    mockCreditLedgerEntry,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    creditLedgerEntry: mockCreditLedgerEntry,
    $transaction: mockTransaction,
  },
}));

import { RegistrationCreditFacet } from '../src/services/core-facets/RegistrationCreditFacet';

function ledger(overrides = {}) {
  return {
    id: 'ledger-1',
    tenantId: 'tenant-quantum',
    userId: 'tenant-user-1',
    entryType: CreditLedgerEntryType.GRANTED,
    amount: 3,
    availableDelta: 3,
    reservedDelta: 0,
    idempotencyKey: null,
    referenceType: null,
    referenceId: null,
    metadata: {},
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    ...overrides,
  };
}

describe('RegistrationCreditFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreditLedgerEntry.findMany.mockResolvedValue([]);
    mockCreditLedgerEntry.findUnique.mockResolvedValue(null);
    mockCreditLedgerEntry.create.mockImplementation(({ data }) => Promise.resolve(ledger(data)));
    mockTransaction.mockImplementation(async (callback) => callback({
      creditLedgerEntry: mockCreditLedgerEntry,
    }));
  });

  it('deriva creditsBalance sem tocar em balance monetario', async () => {
    mockCreditLedgerEntry.findMany.mockResolvedValue([
      ledger({ entryType: CreditLedgerEntryType.GRANTED, amount: 5, availableDelta: 5 }),
      ledger({ entryType: CreditLedgerEntryType.RESERVED, amount: 1, availableDelta: -1, reservedDelta: 1 }),
      ledger({ entryType: CreditLedgerEntryType.CONSUMED, amount: 1, availableDelta: 0, reservedDelta: -1 }),
    ]);

    const summary = await RegistrationCreditFacet.getSummary('tenant-quantum', 'tenant-user-1');

    expect(summary).toMatchObject({
      creditsBalance: 4,
      reserved: 0,
      consumed: 1,
      balance: 0,
      ledgerSource: 'qc-backend-credit-ledger',
    });
  });

  it('consome credito de dependente por reserva e consumo idempotente', async () => {
    mockCreditLedgerEntry.findMany
      .mockResolvedValueOnce([
        ledger({ entryType: CreditLedgerEntryType.GRANTED, amount: 2, availableDelta: 2 }),
      ])
      .mockResolvedValueOnce([
        ledger({ entryType: CreditLedgerEntryType.RESERVED, amount: 1, availableDelta: -1, reservedDelta: 1 }),
      ])
      .mockResolvedValueOnce([
        ledger({ entryType: CreditLedgerEntryType.GRANTED, amount: 2, availableDelta: 2 }),
        ledger({ entryType: CreditLedgerEntryType.RESERVED, amount: 1, availableDelta: -1, reservedDelta: 1 }),
        ledger({ entryType: CreditLedgerEntryType.CONSUMED, amount: 1, availableDelta: 0, reservedDelta: -1 }),
      ]);

    const summary = await RegistrationCreditFacet.consumeForDependentRegistration({
      tenantId: 'tenant-quantum',
      userId: 'tenant-user-1',
      idempotencyKey: 'dependent-1',
      referenceId: 'dependent-1',
    });

    expect(summary.creditsBalance).toBe(1);
    expect(mockCreditLedgerEntry.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        entryType: CreditLedgerEntryType.RESERVED,
        availableDelta: -1,
        reservedDelta: 1,
        referenceType: 'DEPENDENT_REGISTRATION',
      }),
    }));
    expect(mockCreditLedgerEntry.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        entryType: CreditLedgerEntryType.CONSUMED,
        availableDelta: 0,
        reservedDelta: -1,
      }),
    }));
  });

  it('bloqueia consumo sem creditsBalance disponivel', async () => {
    mockCreditLedgerEntry.findMany.mockResolvedValue([]);

    await expect(RegistrationCreditFacet.consumeForAssetRegistration({
      tenantId: 'tenant-quantum',
      userId: 'tenant-user-1',
      idempotencyKey: 'asset-1',
      referenceId: 'asset-1',
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });

    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('reusa entradas existentes por idempotency key sem duplicar consumo', async () => {
    mockCreditLedgerEntry.findUnique
      .mockResolvedValueOnce(ledger({ idempotencyKey: 'dependent-1' }))
      .mockResolvedValueOnce(ledger({ idempotencyKey: 'dependent-1:consume' }));
    mockCreditLedgerEntry.findMany.mockResolvedValue([
      ledger({ entryType: CreditLedgerEntryType.GRANTED, amount: 1, availableDelta: 1 }),
      ledger({ entryType: CreditLedgerEntryType.RESERVED, amount: 1, availableDelta: -1, reservedDelta: 1 }),
      ledger({ entryType: CreditLedgerEntryType.CONSUMED, amount: 1, availableDelta: 0, reservedDelta: -1 }),
    ]);

    await RegistrationCreditFacet.consumeForDependentRegistration({
      tenantId: 'tenant-quantum',
      userId: 'tenant-user-1',
      idempotencyKey: 'dependent-1',
    });

    expect(mockCreditLedgerEntry.create).not.toHaveBeenCalled();
  });
});
