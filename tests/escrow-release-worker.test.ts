// tests/escrow-release-worker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/prisma', () => ({
  default: {
    escrow: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/services/core-facets/EscrowFacet', () => ({
  EscrowFacet: {
    release: vi.fn(),
  },
  ESCROW_WORKER_API_KEY_ID: 'ESCROW_WORKER',
}));

import prisma from '../src/config/prisma';
import { EscrowFacet } from '../src/services/core-facets/EscrowFacet';
import { EscrowReleaseWorker } from '../src/services/EscrowReleaseWorker';

const now = new Date();

const makeEscrow = (overrides = {}) => ({
  id: 'esc-db-1',
  escrowId: 'escrow-1',
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  chain: 'SOLANA',
  releaseMode: 'AUTO',
  status: 'ACTIVE',
  unlockTimestamp: new Date(now.getTime() - 1000), // expired
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EscrowReleaseWorker.processReleases', () => {
  it('✅ processa batch de escrows expirados AUTO', async () => {
    const escrows = [makeEscrow(), makeEscrow({ id: 'esc-db-2', escrowId: 'escrow-2' })];
    vi.mocked(prisma.escrow.findMany).mockResolvedValue(escrows as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({} as any);
    vi.mocked(EscrowFacet.release).mockResolvedValue({ status: 'RELEASED' } as any);

    const result = await EscrowReleaseWorker.processReleases();

    expect(result.released).toBe(2);
    expect(result.failed).toBe(0);
    expect(EscrowFacet.release).toHaveBeenCalledTimes(2);
  });

  it('✅ retorna { released: 0, failed: 0 } quando não há escrows expirados', async () => {
    vi.mocked(prisma.escrow.findMany).mockResolvedValue([]);

    const result = await EscrowReleaseWorker.processReleases();

    expect(result.released).toBe(0);
    expect(result.failed).toBe(0);
    expect(EscrowFacet.release).not.toHaveBeenCalled();
  });

  it('✅ ignora escrows com releaseMode MANUAL', async () => {
    vi.mocked(prisma.escrow.findMany).mockResolvedValue([]);

    await EscrowReleaseWorker.processReleases();

    // findMany deve filtrar releaseMode = 'AUTO' — verificar query
    expect(prisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ releaseMode: 'AUTO' }),
      })
    );
  });

  it('🛡️ isola falha: escrow com erro DLT não bloqueia os demais', async () => {
    const escrows = [
      makeEscrow({ escrowId: 'escrow-fail' }),
      makeEscrow({ id: 'esc-db-2', escrowId: 'escrow-ok' }),
    ];
    vi.mocked(prisma.escrow.findMany).mockResolvedValue(escrows as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({} as any);
    vi.mocked(EscrowFacet.release)
      .mockRejectedValueOnce(new Error('DLT_ANCHOR_FAILED'))
      .mockResolvedValueOnce({ status: 'RELEASED' } as any);

    const result = await EscrowReleaseWorker.processReleases();

    expect(result.released).toBe(1);
    expect(result.failed).toBe(1);
    // Escrow com falha deve ter status revertido para ACTIVE
    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } })
    );
  });

  it('🛡️ marca escrow como PROCESSING antes de processar (overlap lock)', async () => {
    const escrow = makeEscrow();
    vi.mocked(prisma.escrow.findMany).mockResolvedValue([escrow] as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({} as any);
    vi.mocked(EscrowFacet.release).mockResolvedValue({ status: 'RELEASED' } as any);

    await EscrowReleaseWorker.processReleases();

    // Primeiro update: marcar como PROCESSING
    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PROCESSING' } })
    );
  });
});
