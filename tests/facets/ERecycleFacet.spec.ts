import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockWasteLog,
  mockEnvironmentalCredit,
  mockEventLog,
  mockPrismaTransaction,
  mockProcessQueue,
} = vi.hoisted(() => {
  const mockWasteLog = {
    create: vi.fn(),
    update: vi.fn(),
  };

  const mockEnvironmentalCredit = {
    create: vi.fn(),
  };

  const mockEventLog = {
    create: vi.fn(),
  };

  const mockPrismaTransaction = vi.fn(async (cb: any) =>
    cb({
      wasteLog: mockWasteLog,
      environmentalCredit: mockEnvironmentalCredit,
      eventLog: mockEventLog,
    })
  );

  const mockProcessQueue = vi.fn().mockResolvedValue({ processed: 1, items: [] });

  return {
    mockWasteLog,
    mockEnvironmentalCredit,
    mockEventLog,
    mockPrismaTransaction,
    mockProcessQueue,
  };
});

vi.mock('../../src/config/prisma', () => ({
  default: {
    $transaction: mockPrismaTransaction,
    wasteLog: mockWasteLog,
    environmentalCredit: mockEnvironmentalCredit,
    eventLog: mockEventLog,
  },
}));

vi.mock('../../src/services/AnchorQueueService', () => ({
  AnchorQueueService: {
    processQueue: mockProcessQueue,
  },
}));

vi.mock('crypto', () => {
  const createHash = vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('deadbeef'),
  }));

  return {
    default: { createHash },
    createHash,
  };
});

import crypto from 'crypto';
import { ERecycleFacet } from '../../src/services/core-facets/ERecycleFacet';

describe('ERecycleFacet', () => {
  beforeEach(() => {
    mockWasteLog.create.mockReset();
    mockWasteLog.update.mockReset();
    mockEnvironmentalCredit.create.mockReset();
    mockEventLog.create.mockReset();

    // Reset crypto mock call history
    (crypto as any).createHash.mockClear?.();
  });

  it('recordWaste: success persists WasteLog, emits EventLog, uses SHA3-512, and enqueues anchoring', async () => {
    mockWasteLog.create.mockResolvedValue({ id: 'waste_001' });
    mockWasteLog.update.mockResolvedValue({ id: 'waste_001', eventLogId: 'event_001' });
    mockEventLog.create.mockResolvedValue({ id: 'event_001' });

    const res = await ERecycleFacet.recordWaste(
      { tenantId: 'tenant_001', apiKeyId: 'api_001', role: 'ADMIN' },
      {
        containerId: 'container_01',
        wasteType: 'opaque_type',
        weightKg: 12.34,
        locationMetadata: { city: 'X' },
        timestamp: new Date('2026-01-01T00:00:00Z'),
      }
    );

    expect(mockWasteLog.create).toHaveBeenCalledOnce();
    expect(mockEventLog.create).toHaveBeenCalledOnce();
    expect(mockWasteLog.update).toHaveBeenCalledOnce();

    expect((crypto as any).createHash).toHaveBeenCalled();
    expect((crypto as any).createHash.mock.calls[0][0]).toBe('sha3-512');

    expect(mockProcessQueue).toHaveBeenCalled();
    expect(res).toMatchObject({ wasteLogId: 'waste_001', eventLogId: 'event_001' });
  });

  it('issueCredit: success persists EnvironmentalCredit, emits EventLog, uses SHA3-512, and enqueues anchoring', async () => {
    mockEnvironmentalCredit.create.mockResolvedValue({ id: 'credit_001' });
    mockEventLog.create.mockResolvedValue({ id: 'event_002' });

    const res = await ERecycleFacet.issueCredit(
      { tenantId: 'tenant_001', apiKeyId: 'api_001', role: 'OPERATOR' },
      {
        wasteLogId: 'waste_001',
        creditAmount: 100,
        recipientOwnerId: 'owner_abc',
        metadata: { x: 1 },
      }
    );

    expect(mockEnvironmentalCredit.create).toHaveBeenCalledOnce();
    expect(mockEventLog.create).toHaveBeenCalledOnce();

    expect((crypto as any).createHash).toHaveBeenCalled();
    expect((crypto as any).createHash.mock.calls[0][0]).toBe('sha3-512');

    expect(mockProcessQueue).toHaveBeenCalled();
    expect(res).toMatchObject({ environmentalCreditId: 'credit_001', eventLogId: 'event_002' });
  });

  it('recordWaste: rejects when role is not ADMIN/OPERATOR', async () => {
    await expect(
      ERecycleFacet.recordWaste(
        { tenantId: 'tenant_001', apiKeyId: 'api_001', role: 'READER' },
        {
          containerId: 'container_01',
          wasteType: 'opaque_type',
          weightKg: 12.34,
          locationMetadata: { city: 'X' },
          timestamp: new Date('2026-01-01T00:00:00Z'),
        }
      )
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });

    expect(mockWasteLog.create).not.toHaveBeenCalled();
  });

  it('issueCredit: rejects when role is not ADMIN/OPERATOR', async () => {
    await expect(
      ERecycleFacet.issueCredit(
        { tenantId: 'tenant_001', apiKeyId: 'api_001', role: 'READER' },
        {
          wasteLogId: 'waste_001',
          creditAmount: 100,
          recipientOwnerId: 'owner_abc',
          metadata: { x: 1 },
        }
      )
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });

    expect(mockEnvironmentalCredit.create).not.toHaveBeenCalled();
  });
});
