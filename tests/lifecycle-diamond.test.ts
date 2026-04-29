// tests/lifecycle-diamond.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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
    eventLog: { create: vi.fn() },
  },
}));

// Import app AFTER mocks are set up
import { app } from '../src/server';
import prisma from '../src/config/prisma';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Diamond lifecycle.transition (pós-migração)', () => {
  it('✅ 200 — DRAFT → ACTIVE via Diamond', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1', tenantId: 'tenant-1', status: 'DRAFT',
    } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'ACTIVE' } });

    expect(res.status).toBe(200);
    expect(res.body.data.currentState).toBe('ACTIVE');
    expect(res.body.data.previousState).toBe('DRAFT');
  });

  it('🚫 400 — transição inválida DRAFT → BURNED retorna código de erro', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1', tenantId: 'tenant-1', status: 'DRAFT',
    } as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'BURNED' } });

    // DiamondProxy maps known errors (error.code + error.message) to HTTP 400
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('STATE_TRANSITION_FORBIDDEN');
  });

  it('🚫 400 — asset LOCKED_IN_ESCROW bloqueado pelo LifecycleFacet', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1', tenantId: 'tenant-1', status: 'LOCKED_IN_ESCROW',
    } as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'ACTIVE' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ASSET_LOCKED_IN_ESCROW');
  });

  it('🚫 401 — sem API key', async () => {
    const res = await request(app)
      .post('/api/v1/diamond')
      .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'ACTIVE' } });

    expect(res.status).toBe(401);
  });

  it('🚫 404 — rota REST antiga PATCH /api/v1/assets/:id/lifecycle não existe mais', async () => {
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/lifecycle')
      .set('X-API-Key', 'qc_test_key')
      .send({ targetState: 'ACTIVE' });

    expect(res.status).toBe(404);
  });
});
