// tests/asset-controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/middleware/apiKeyAuth', () => ({
  requireApiKey: (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-1';
    req.apiKeyId = 'key-1';
    req.apiKeyRole = req.headers['x-role'] || 'ADMIN';
    req.apiKeyPrefix = 'qc_test';
    next();
  },
  optionalApiKey: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/rateLimiter', () => ({
  tenantRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/idempotencyGuard', () => ({
  requireIdempotency: (req: any, res: any, next: any) => {
    if (!req.headers['x-idempotency-key']) {
      return res.status(422).json({ success: false, error: 'X-Idempotency-Key header is required.' });
    }
    next();
  },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    $transaction: vi.fn(async (cb: any) => cb({
      asset: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    })),
    asset: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    owner: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { app } from '../src/server';
import prisma from '../src/config/prisma';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── BUG #1: async sem try-catch → request pendurado ────────────────────────
// Antes do fix: Zod lança exceção → sem try-catch → Express 4 não propaga →
// request fica sem resposta (timeout). Após o fix: retorna 400.
describe('POST /api/v1/assets — async error handling (bug #1)', () => {
  it('retorna 400 (não pende) quando o body tem status inválido', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idem-1')
      .send({ status: 'NAO_EXISTE_ESTE_STATUS' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('retorna 422 (não pende) quando X-Idempotency-Key está ausente', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .set('X-API-Key', 'qc_test_key')
      .send({ metadata: { name: 'Test' } });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});

// ─── BUG #2: RBAC no facet bloqueia OPERATOR ────────────────────────────────
// Antes do fix: OPERATOR recebia "Forbidden: Insufficient privileges"
// → sem try-catch → request pendurado. Após: OPERATOR cria asset com 201.
describe('POST /api/v1/assets — RBAC OPERATOR (bug #2)', () => {
  it('OPERATOR consegue criar ativo (201)', async () => {
    const createdAsset = {
      id: 'asset-uuid-1',
      tenantId: 'tenant-1',
      externalId: 'EXT-001',
      metadata: {},
      status: 'ACTIVE',
      owners: [],
      device: null,
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      return cb({
        asset: { create: vi.fn().mockResolvedValue(createdAsset) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      });
    });

    const res = await request(app)
      .post('/api/v1/assets')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Role', 'OPERATOR')
      .set('X-Idempotency-Key', 'idem-operator-1')
      .send({ externalId: 'EXT-001', metadata: { name: 'Produto' } });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('asset-uuid-1');
  });

  it('ADMIN consegue criar ativo (201)', async () => {
    const createdAsset = {
      id: 'asset-uuid-2',
      tenantId: 'tenant-1',
      metadata: {},
      status: 'ACTIVE',
      owners: [],
      device: null,
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      return cb({
        asset: { create: vi.fn().mockResolvedValue(createdAsset) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      });
    });

    const res = await request(app)
      .post('/api/v1/assets')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Role', 'ADMIN')
      .set('X-Idempotency-Key', 'idem-admin-1')
      .send({ metadata: { name: 'Produto Admin' } });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('READER é bloqueado pelo rbacGuard (403)', async () => {
    const res = await request(app)
      .post('/api/v1/assets')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Role', 'READER')
      .set('X-Idempotency-Key', 'idem-reader-1')
      .send({ metadata: {} });

    expect(res.status).toBe(403);
  });
});

// ─── BUG #3: enum de status incompleto ───────────────────────────────────────
// DRAFT e SUSPENDED são estados válidos no Prisma mas faltavam no schema Zod.
describe('POST /api/v1/assets — status enum completo (bug #3)', () => {
  const validStatuses = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'AWAITING_PAYMENT', 'LOCKED_IN_ESCROW'];

  for (const status of validStatuses) {
    it(`aceita status=${status} sem retornar 400 de validação`, async () => {
      const createdAsset = { id: 'a', tenantId: 'tenant-1', metadata: {}, status, owners: [], device: null };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
        return cb({
          asset: { create: vi.fn().mockResolvedValue(createdAsset) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        });
      });

      const res = await request(app)
        .post('/api/v1/assets')
        .set('X-API-Key', 'qc_test_key')
        .set('X-Role', 'ADMIN')
        .set('X-Idempotency-Key', `idem-status-${status}`)
        .send({ status });

      // Não deve retornar 400 por falha de validação do enum
      expect(res.status).not.toBe(400);
    });
  }
});
