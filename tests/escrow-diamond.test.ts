// tests/escrow-diamond.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─────────────────────────────────────────────────────────
// Mock apiKeyAuth BEFORE importing app so the middleware is
// replaced before Express registers it into the route chain.
// ─────────────────────────────────────────────────────────
vi.mock('../src/middleware/apiKeyAuth', () => ({
  requireApiKey: (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.tenantId = 'tenant-1';
    req.apiKeyId = 'key-1';
    req.apiKeyRole = 'ADMIN';
    req.apiKeyPrefix = 'qc_test';
    next();
  },
  optionalApiKey: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    asset: { findUnique: vi.fn(), update: vi.fn() },
    escrow: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    eventLog: { create: vi.fn() },
  },
}));

vi.mock('../src/services/DLTAdapterFactory', () => ({
  DLTAdapterFactory: {
    getAdapter: vi.fn(() => ({
      createEscrow: vi.fn().mockResolvedValue('mock-chain-tx'),
      releaseEscrow: vi.fn().mockResolvedValue('mock-release-tx'),
      cancelEscrow: vi.fn().mockResolvedValue('mock-cancel-tx'),
    })),
  },
}));

// Import app AFTER mocks are set up
import { app } from '../src/server';
import prisma from '../src/config/prisma';

// ─────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────
const mockAssetActive = { id: 'asset-1', tenantId: 'tenant-1', status: 'ACTIVE' };

const mockEscrowActive = {
  id: 'esc-db-1',
  escrowId: 'esc-uuid-1',
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  chain: 'SOLANA',
  status: 'ACTIVE',
  releaseMode: 'MANUAL',
  chainTxId: 'mock-chain-tx',
  unlockTimestamp: new Date(Date.now() + 86400000),
  releaseConfirmedAt: null,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────
// escrow.lock
// ─────────────────────────────────────────────────────────
describe('Diamond escrow.lock', () => {
  it('✅ 200 — lock com payload válido', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAssetActive as any);
    vi.mocked(prisma.escrow.create).mockResolvedValue({ ...mockEscrowActive, chainTxId: null } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({
        selector: 'escrow.lock',
        payload: {
          assetId: 'asset-1',
          escrowId: 'esc-uuid-1',
          chain: 'SOLANA',
          sender: 'sender-wallet',
          receiver: 'receiver-wallet',
          amount: '1000000',
          unlockTimestamp: Math.floor(Date.now() / 1000) + 86400,
          releaseMode: 'MANUAL',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.escrowId).toBe('esc-uuid-1');
  });

  it('🚫 401 — sem API key', async () => {
    const res = await request(app)
      .post('/api/v1/diamond')
      .send({ selector: 'escrow.lock', payload: {} });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────
// escrow.release
// ─────────────────────────────────────────────────────────
describe('Diamond escrow.release', () => {
  it('✅ 200 — release MANUAL por ADMIN', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, releaseMode: 'MANUAL' } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'escrow.release', payload: { escrowId: 'esc-uuid-1', assetId: 'asset-1' } });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RELEASED');
  });
});

// ─────────────────────────────────────────────────────────
// escrow.cancel
// ─────────────────────────────────────────────────────────
describe('Diamond escrow.cancel', () => {
  it('✅ 200 — cancel por ADMIN', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'CANCELLED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'escrow.cancel', payload: { escrowId: 'esc-uuid-1', assetId: 'asset-1' } });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });
});

// ─────────────────────────────────────────────────────────
// escrow.status
// ─────────────────────────────────────────────────────────
describe('Diamond escrow.status', () => {
  it('✅ 200 — consulta status sem idempotência', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'escrow.status', payload: { escrowId: 'esc-uuid-1' } });

    expect(res.status).toBe(200);
    expect(res.body.data.escrowId).toBe('esc-uuid-1');
    expect(res.body.data.releaseMode).toBe('MANUAL');
  });
});
