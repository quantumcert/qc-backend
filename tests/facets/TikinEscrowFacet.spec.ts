import { describe, it, expect, vi, beforeEach } from 'vitest';

// This test file focuses on integration points (permission checks, Prisma writes, and DLTAdapter calls)
// using mocks only. It does NOT require DATABASE_URL.

const { mockAsset, mockEscrowRecord, mockEventLog } = vi.hoisted(() => ({
  mockAsset: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  mockEscrowRecord: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  mockEventLog: {
    create: vi.fn(),
  },
}));

const mockPrismaTx = vi.hoisted(() => vi.fn(async (cb: any) => cb({})));

vi.mock('../../src/config/prisma', () => ({
  default: {
    asset: mockAsset,
    escrowRecord: mockEscrowRecord,
    eventLog: mockEventLog,
    $transaction: mockPrismaTx,
  },
}));

const mockCreateEscrow = vi.fn().mockResolvedValue('TX_CREATE_1');
const mockReleaseEscrow = vi.fn().mockResolvedValue('TX_RELEASE_1');
const mockCancelEscrow = vi.fn().mockResolvedValue('TX_CANCEL_1');

vi.mock('../../src/services/DLTAdapterFactory', () => ({
  DLTAdapterFactory: {
    getAdapter: vi.fn(() => ({
      createEscrow: mockCreateEscrow,
      releaseEscrow: mockReleaseEscrow,
      cancelEscrow: mockCancelEscrow,
    })),
  },
}));

import { TikinEscrowFacet } from '../../src/services/core-facets/TikinEscrowFacet';
import type { SupportedChain } from '../../src/services/DLTAdapterFactory';

describe('TikinEscrowFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escrow.lock: success enforces ADMIN/OPERATOR, writes EscrowRecord and updates Asset', async () => {
    mockAsset.findUnique.mockResolvedValue({ id: 'asset_1', tenantId: 'tenant_1', status: 'ACTIVE' });
    mockEscrowRecord.create.mockResolvedValue({ id: 'escrow_record_prisma_1' });
    mockEscrowRecord.update.mockResolvedValue({ id: 'escrow_record_prisma_1' });
    mockEventLog.create.mockResolvedValue({ id: 'event_1' });

    const res = await TikinEscrowFacet.lock(
      { tenantId: 'tenant_1', apiKeyId: 'api_1', role: 'ADMIN' },
      {
        // Payload follows current facet implementation shape
        assetId: 'asset_1',
        escrowRecordId: 'escrow_record_ext_1',
        chain: 'ALGORAND' as SupportedChain,
        sender: 'sender_wallet',
        receiver: 'receiver_wallet',
        amount: '1000',
        unlockTimestamp: Math.floor(Date.now() / 1000) + 60,
        releaseMode: 'AUTO',
      }
    );

    expect(res.escrowRecordId).toBe('escrow_record_ext_1');
    expect(mockEscrowRecord.create).toHaveBeenCalledOnce();
    expect(mockAsset.update).toHaveBeenCalledOnce();
    expect(mockCreateEscrow).toHaveBeenCalledOnce();
    expect(mockEventLog.create).toHaveBeenCalledOnce();
  });

  it('escrow.release: success enforces role and unlock condition, writes status and calls adapter', async () => {
    mockEscrowRecord.findFirst.mockResolvedValue({
      id: 'escrow_record_prisma_1',
      escrowRecordId: 'escrow_record_ext_1',
      tenantId: 'tenant_1',
      status: 'ACTIVE',
      chain: 'ALGORAND',
      unlockTimestamp: new Date(Date.now() - 10_000),
      releaseMode: 'AUTO',
    });
    mockEscrowRecord.update.mockResolvedValue({ id: 'escrow_record_prisma_1' });
    mockAsset.update.mockResolvedValue({});
    mockEventLog.create.mockResolvedValue({ id: 'event_2' });

    const res = await TikinEscrowFacet.release(
      { tenantId: 'tenant_1', apiKeyId: 'api_1', role: 'OPERATOR' },
      { escrowRecordId: 'escrow_record_ext_1', assetId: 'asset_1' }
    );

    expect(res.status).toBe('RELEASED');
    expect(mockReleaseEscrow).toHaveBeenCalledOnce();
    expect(mockEscrowRecord.update).toHaveBeenCalledOnce();
    expect(mockEventLog.create).toHaveBeenCalledOnce();
  });

  it('escrow.cancel: success only for ADMIN', async () => {
    mockEscrowRecord.findFirst.mockResolvedValue({
      id: 'escrow_record_prisma_1',
      escrowRecordId: 'escrow_record_ext_1',
      tenantId: 'tenant_1',
      status: 'ACTIVE',
      chain: 'ALGORAND',
    });

    mockEscrowRecord.update.mockResolvedValue({ id: 'escrow_record_prisma_1' });
    mockAsset.update.mockResolvedValue({});
    mockEventLog.create.mockResolvedValue({ id: 'event_3' });

    const res = await TikinEscrowFacet.cancel(
      { tenantId: 'tenant_1', apiKeyId: 'api_1', role: 'ADMIN' },
      { escrowRecordId: 'escrow_record_ext_1', assetId: 'asset_1' }
    );

    expect(res.status).toBe('CANCELLED');
    expect(mockCancelEscrow).toHaveBeenCalledOnce();
    expect(mockEventLog.create).toHaveBeenCalledOnce();
  });

  it('escrow.lock: rejects non ADMIN/OPERATOR', async () => {
    await expect(
      TikinEscrowFacet.lock(
        { tenantId: 'tenant_1', apiKeyId: 'api_1', role: 'READER' },
        {
          assetId: 'asset_1',
          escrowRecordId: 'escrow_record_ext_1',
          chain: 'ALGORAND' as SupportedChain,
          sender: 'sender_wallet',
          receiver: 'receiver_wallet',
          amount: '1000',
          unlockTimestamp: Math.floor(Date.now() / 1000) + 60,
          releaseMode: 'AUTO',
        }
      )
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });

    expect(mockEscrowRecord.create).not.toHaveBeenCalled();
    expect(mockCreateEscrow).not.toHaveBeenCalled();
  });
});

