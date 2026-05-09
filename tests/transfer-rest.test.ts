// tests/transfer-rest.test.ts
// REST wrapper for TransferRegistryFacet.initiateTransfer
// Covers: CORE-02 — PATCH /api/v1/assets/:assetId/transfer

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mock middleware ─────────────────────────────────────────────────────────
vi.mock('../src/middleware/apiKeyAuth', () => ({
  requireApiKey: (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.tenantId = 'tenant-1';
    req.apiKeyId = 'key-1';
    req.apiKeyRole = req.headers['x-role-override'] ?? 'OPERATOR';
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
    const key = req.headers['x-idempotency-key'];
    if (!key) {
      return res.status(400).json({ success: false, error: 'X-Idempotency-Key header is required' });
    }
    next();
  },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    asset: { findUnique: vi.fn(), update: vi.fn() },
    owner: { findFirst: vi.fn(), create: vi.fn() },
    eventLog: { create: vi.fn() },
  },
}));

// BillingFacet calls MercadoPago externally — mock the whole module
vi.mock('../src/services/core-facets/BillingFacet', () => ({
  BillingFacet: {
    createPaymentPreference: vi.fn().mockResolvedValue({
      initPoint: 'https://mp.mock/checkout/mock-preference-id',
      preferenceId: 'mock-preference-id',
    }),
  },
}));

// Import app AFTER mocks are set up
import { app } from '../src/server';
import prisma from '../src/config/prisma';

// Fixtures
const mockActiveAsset = {
  id: 'asset-1',
  tenantId: 'tenant-1',
  status: 'ACTIVE',
  externalId: 'EXT-001',
  tenant: { id: 'tenant-1', customTransferFee: 49.99 },
};

const mockOwner = {
  id: 'owner-1',
  assetId: 'asset-1',
  document: '12345678901',
  documentType: 'CPF',
  ownerRef: '12345678901',
  label: 'Shadow Account (Pending Payment)',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('REST PATCH /api/v1/assets/:assetId/transfer (CORE-02)', () => {
  it('✅ 200 — OPERATOR com idempotency key inicia transfer e retorna paymentLink + assetId', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockActiveAsset as any);
    vi.mocked(prisma.owner.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.owner.create).mockResolvedValue(mockOwner as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .patch('/api/v1/assets/asset-1/transfer')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idem-001')
      .send({ buyerDocument: '123.456.789-01', documentType: 'CPF' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.paymentLink).toBe('https://mp.mock/checkout/mock-preference-id');
    expect(res.body.data.assetId).toBe('asset-1');
    expect(res.body.data.status).toBe('AWAITING_PAYMENT');
  });

  it('🚫 401 — sem X-API-Key retorna 401', async () => {
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/transfer')
      .set('X-Idempotency-Key', 'idem-002')
      .send({ buyerDocument: '12345678901', documentType: 'CPF' });

    expect(res.status).toBe(401);
  });

  it('🚫 403 — role READER retorna 403', async () => {
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/transfer')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idem-003')
      .set('x-role-override', 'READER')
      .send({ buyerDocument: '12345678901', documentType: 'CPF' });

    expect(res.status).toBe(403);
  });

  it('🚫 400 — sem X-Idempotency-Key retorna 400', async () => {
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/transfer')
      .set('X-API-Key', 'qc_test_key')
      .send({ buyerDocument: '12345678901', documentType: 'CPF' });

    expect(res.status).toBe(400);
  });

  it('🚫 404 — assetId de outro tenant retorna 404 (isolamento)', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null); // not found for this tenant

    const res = await request(app)
      .patch('/api/v1/assets/asset-other-tenant/transfer')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idem-004')
      .send({ buyerDocument: '12345678901', documentType: 'CPF' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
