import { describe, expect, it } from 'vitest';
import { MigrationMode, MigrationRecordStatus, MigrationRunStatus, Prisma } from '@prisma/client';

describe('Phase 4 Tenant Quantum backfill schema foundation', () => {
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
});
