// tests/escrow-facet.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('../src/config/prisma', () => ({
  default: {
    asset: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    escrow: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    eventLog: {
      create: vi.fn(),
    },
  },
}));

// Mock DLTAdapterFactory
vi.mock('../src/services/DLTAdapterFactory', () => ({
  DLTAdapterFactory: {
    getAdapter: vi.fn(() => ({
      createEscrow: vi.fn().mockResolvedValue('mock-chain-tx-id'),
      releaseEscrow: vi.fn().mockResolvedValue('mock-release-tx-id'),
      cancelEscrow: vi.fn().mockResolvedValue('mock-cancel-tx-id'),
    })),
  },
}));

import prisma from '../src/config/prisma';
import { DLTAdapterFactory } from '../src/services/DLTAdapterFactory';
import { EscrowFacet, ESCROW_WORKER_API_KEY_ID } from '../src/services/core-facets/EscrowFacet';

const adminCtx = { tenantId: 'tenant-1', apiKeyId: 'key-1', role: 'ADMIN' };
const operatorCtx = { tenantId: 'tenant-1', apiKeyId: 'key-2', role: 'OPERATOR' };
const readerCtx = { tenantId: 'tenant-1', apiKeyId: 'key-3', role: 'READER' };

const mockAsset = { id: 'asset-1', tenantId: 'tenant-1', status: 'ACTIVE' };
const mockEscrowActive = {
  id: 'esc-db-1',
  escrowId: 'escrow-1',
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  chain: 'SOLANA',
  chainTxId: 'mock-chain-tx-id',
  status: 'ACTIVE',
  releaseMode: 'AUTO',
  sender: 'sender-wallet',
  receiver: 'receiver-wallet',
  amount: '1000000',
  unlockTimestamp: new Date(Date.now() + 86400000), // tomorrow
  releaseConfirmedAt: null,
};

const lockPayload = {
  assetId: 'asset-1',
  escrowId: 'escrow-1',
  chain: 'SOLANA' as const,
  sender: 'sender-wallet',
  receiver: 'receiver-wallet',
  amount: '1000000',
  unlockTimestamp: Math.floor(Date.now() / 1000) + 86400, // tomorrow in Unix seconds
  releaseMode: 'AUTO' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EscrowFacet.lock', () => {
  it('✅ locks asset and creates escrow record', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.escrow.create).mockResolvedValue({ ...mockEscrowActive, chainTxId: null } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({ ...mockAsset, status: 'LOCKED_IN_ESCROW' } as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.lock(adminCtx, lockPayload);

    expect(result.escrowId).toBe('escrow-1');
    expect(result.assetId).toBe('asset-1');
    expect(result.chainTxId).toBe('mock-chain-tx-id');
    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'LOCKED_IN_ESCROW' } })
    );
    expect(prisma.eventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ action: 'ESCROW_LOCKED' }) }) })
    );
  });

  it('✅ OPERATOR pode fazer lock', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.escrow.create).mockResolvedValue({ ...mockEscrowActive, chainTxId: null } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    await expect(EscrowFacet.lock(operatorCtx, lockPayload)).resolves.toBeDefined();
  });

  it('🚫 rejeita se asset não está ACTIVE', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({ ...mockAsset, status: 'SUSPENDED' } as any);

    await expect(EscrowFacet.lock(adminCtx, lockPayload)).rejects.toMatchObject({
      code: 'INVALID_ASSET_STATE',
    });
  });

  it('🚫 rejeita se asset não encontrado', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

    await expect(EscrowFacet.lock(adminCtx, lockPayload)).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
    });
  });

  it('🚫 rejeita unlockTimestamp no passado', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);

    await expect(
      EscrowFacet.lock(adminCtx, { ...lockPayload, unlockTimestamp: Math.floor(Date.now() / 1000) - 100 })
    ).rejects.toMatchObject({ code: 'INVALID_UNLOCK_TIMESTAMP' });
  });

  it('🚫 READER não pode fazer lock', async () => {
    await expect(EscrowFacet.lock(readerCtx, lockPayload)).rejects.toMatchObject({
      code: 'INSUFFICIENT_ROLE',
    });
    expect(prisma.asset.findUnique).not.toHaveBeenCalled();
  });
});

describe('EscrowFacet.release', () => {
  it('✅ release MANUAL por OPERATOR', async () => {
    const manualEscrow = { ...mockEscrowActive, releaseMode: 'MANUAL' };
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(manualEscrow as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...manualEscrow, status: 'RELEASED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.release(operatorCtx, { escrowId: 'escrow-1', assetId: 'asset-1' });

    expect(result.status).toBe('RELEASED');
    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ releaseConfirmedAt: expect.any(Date) }) })
    );
  });

  it('✅ release AUTO pelo worker (secureContext sintético)', async () => {
    const workerCtx = { tenantId: 'tenant-1', apiKeyId: ESCROW_WORKER_API_KEY_ID, role: 'ADMIN' };
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.release(workerCtx, { escrowId: 'escrow-1', assetId: 'asset-1' });
    expect(result.status).toBe('RELEASED');
    const updateCall = vi.mocked(prisma.escrow.update).mock.calls[0][0] as any;
    expect(updateCall.data).not.toHaveProperty('releaseConfirmedAt');
  });

  it('🚫 rejeita release REST em escrow AUTO', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, releaseMode: 'AUTO' } as any);

    await expect(
      EscrowFacet.release(operatorCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'RELEASE_MODE_MISMATCH' });
  });

  it('🚫 rejeita se escrow não encontrado', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(null);

    await expect(
      EscrowFacet.release(adminCtx, { escrowId: 'no-escrow', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_NOT_FOUND' });
  });

  it('🚫 rejeita se escrow já RELEASED', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);

    await expect(
      EscrowFacet.release(adminCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_ALREADY_CLOSED' });
  });
});

describe('EscrowFacet.cancel', () => {
  it('✅ ADMIN pode cancelar escrow ACTIVE', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'CANCELLED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.cancel(adminCtx, { escrowId: 'escrow-1', assetId: 'asset-1' });
    expect(result.status).toBe('CANCELLED');
  });

  it('🚫 OPERATOR não pode cancelar', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);

    await expect(
      EscrowFacet.cancel(operatorCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('🚫 rejeita cancelar escrow já RELEASED', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);

    await expect(
      EscrowFacet.cancel(adminCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_ALREADY_CLOSED' });
  });

  it('🚫 rejeita se escrow não encontrado', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(null);

    await expect(
      EscrowFacet.cancel(adminCtx, { escrowId: 'no-escrow', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_NOT_FOUND' });
  });
});

describe('EscrowFacet.getStatus', () => {
  it('✅ READER pode consultar status', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);

    const result = await EscrowFacet.getStatus(readerCtx, { escrowId: 'escrow-1' });
    expect(result.escrowId).toBe('escrow-1');
    expect(result.status).toBe('ACTIVE');
    expect(result.releaseMode).toBe('AUTO');
  });

  it('🚫 rejeita se escrow não encontrado', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(null);

    await expect(
      EscrowFacet.getStatus(adminCtx, { escrowId: 'no-escrow' })
    ).rejects.toMatchObject({ code: 'ESCROW_NOT_FOUND' });
  });
});
