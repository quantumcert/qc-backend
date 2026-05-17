import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrationMode, MigrationRecordStatus, MigrationRunStatus, Prisma } from '@prisma/client';

const {
  mockEnsureTenantQuantum,
  mockUpsertB2CUser,
  mockRecordPurchasedCredits,
  mockMigrationRun,
  mockMigrationCheckpoint,
  mockMigrationRecord,
  mockOwner,
  mockQTagLedgerEntry,
  mockTransaction,
} = vi.hoisted(() => {
  const mockEnsureTenantQuantum = vi.fn();
  const mockUpsertB2CUser = vi.fn();
  const mockRecordPurchasedCredits = vi.fn();
  const mockMigrationRun = {
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockMigrationCheckpoint = {
    upsert: vi.fn(),
    update: vi.fn(),
  };
  const mockMigrationRecord = {
    upsert: vi.fn(),
  };
  const mockOwner = {
    updateMany: vi.fn(),
  };
  const mockQTagLedgerEntry = {
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockTransaction = vi.fn(async (callback) => callback({
    owner: mockOwner,
    qTagLedgerEntry: mockQTagLedgerEntry,
    migrationRecord: mockMigrationRecord,
  }));

  return {
    mockEnsureTenantQuantum,
    mockUpsertB2CUser,
    mockRecordPurchasedCredits,
    mockMigrationRun,
    mockMigrationCheckpoint,
    mockMigrationRecord,
    mockOwner,
    mockQTagLedgerEntry,
    mockTransaction,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    migrationRun: mockMigrationRun,
    migrationCheckpoint: mockMigrationCheckpoint,
    migrationRecord: mockMigrationRecord,
    owner: mockOwner,
    qTagLedgerEntry: mockQTagLedgerEntry,
    $transaction: mockTransaction,
  },
}));

vi.mock('../src/services/core-facets/TenantUserFacet', () => ({
  TenantUserFacet: {
    ensureTenantQuantum: mockEnsureTenantQuantum,
    upsertB2CUser: mockUpsertB2CUser,
  },
}));

vi.mock('../src/services/core-facets/CreditLedgerFacet', () => ({
  CreditLedgerFacet: {
    recordPurchasedCredits: mockRecordPurchasedCredits,
  },
}));

import { TenantQuantumBackfillFacet } from '../src/services/core-facets/TenantQuantumBackfillFacet';

describe('Phase 4 Tenant Quantum backfill schema foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureTenantQuantum.mockResolvedValue({
      id: 'tenant-quantum',
      slug: 'quantum-cert-platform',
      targetChain: 'STELLAR',
    });
    mockMigrationRun.create.mockResolvedValue({
      id: 'migration-run-1',
      tenantId: 'tenant-quantum',
      status: MigrationRunStatus.RUNNING,
    });
    mockMigrationRun.update.mockResolvedValue({});
    mockMigrationCheckpoint.upsert.mockResolvedValue({});
    mockMigrationCheckpoint.update.mockResolvedValue({});
    mockMigrationRecord.upsert.mockResolvedValue({});
    mockTransaction.mockImplementation(async (callback) => callback({
      owner: mockOwner,
      qTagLedgerEntry: mockQTagLedgerEntry,
      migrationRecord: mockMigrationRecord,
    }));
    mockOwner.updateMany.mockResolvedValue({ count: 0 });
    mockQTagLedgerEntry.findUnique.mockResolvedValue(null);
    mockQTagLedgerEntry.create.mockResolvedValue({ id: 'qtag-entry-1' });
    mockRecordPurchasedCredits.mockResolvedValue({ id: 'credit-entry-1' });
  });

  it('exposes idempotent migration models for dry-run and execute flows', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toContain('MigrationRun');
    expect(modelNames).toContain('MigrationCheckpoint');
    expect(modelNames).toContain('MigrationRecord');

    expect(MigrationMode.DRY_RUN).toBe('DRY_RUN');
    expect(MigrationMode.EXECUTE).toBe('EXECUTE');
    expect(MigrationRunStatus.RUNNING).toBe('RUNNING');
    expect(MigrationRecordStatus.CONFLICT).toBe('CONFLICT');
  });

  it('includes commercial, credit, payment and QTAG foundation models', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toContain('PurchaseOrder');
    expect(modelNames).toContain('PaymentIntent');
    expect(modelNames).toContain('PaymentEvent');
    expect(modelNames).toContain('CreditLedgerEntry');
    expect(modelNames).toContain('QTagLedgerEntry');
    expect(modelNames).toContain('QTagFulfillmentOrder');
  });

  it('runs a dry-run without domain writes and reports unsafe duplicates', async () => {
    const report = await TenantQuantumBackfillFacet.dryRun({
      batchSize: 2,
      users: [
        { id: 1, openId: 'user-1', email: 'one@example.com', cpf: '111.111.111-11' },
        { id: 2, openId: 'user-2', email: 'two@example.com', cpf: '11111111111' },
        { id: 3, openId: 'user-3', email: 'three@example.com', cpf: '22222222222' },
      ],
    });

    expect(report).toMatchObject({
      mode: MigrationMode.DRY_RUN,
      sourceCount: 3,
      skippedCount: 1,
      conflictCount: 2,
      errorCount: 0,
    });
    expect(mockUpsertB2CUser).not.toHaveBeenCalled();
    expect(mockOwner.updateMany).not.toHaveBeenCalled();
    expect(mockMigrationRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: MigrationRecordStatus.CONFLICT,
        error: 'CPF duplicado na origem do dashboard.',
      }),
    }));
  });

  it('executes idempotent user, owner, credit and QTAG reconciliation', async () => {
    mockUpsertB2CUser.mockResolvedValue({
      id: 'tenant-user-1',
      tenantId: 'tenant-quantum',
    });
    mockOwner.updateMany.mockResolvedValue({ count: 2 });
    mockQTagLedgerEntry.create.mockResolvedValue({ id: 'qtag-entry-1' });

    const report = await TenantQuantumBackfillFacet.execute({
      batchSize: 1,
      users: [
        {
          id: 42,
          openId: 'dev@localhost',
          email: 'dev@localhost',
          cpf: '348.880.158-64',
          name: 'Developer User',
          creditsBalance: 5,
          qtagsBalance: 2,
        },
      ],
    });

    expect(report).toMatchObject({
      mode: MigrationMode.EXECUTE,
      migratedCount: 1,
      conflictCount: 0,
      errorCount: 0,
      status: MigrationRunStatus.COMPLETED,
    });
    expect(mockUpsertB2CUser).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-quantum',
      legacyDashboardUserId: 42,
      legacyOpenId: 'dev@localhost',
      cpf: '348.880.158-64',
    }));
    expect(mockOwner.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerRef: 'tenant-user-1',
        document: '34888015864',
        documentType: 'CPF',
      }),
    }));
    expect(mockRecordPurchasedCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-quantum',
      userId: 'tenant-user-1',
      amount: 5,
    }));
    expect(mockQTagLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-quantum',
        userId: 'tenant-user-1',
        quantity: 2,
      }),
    }));
  });
});
