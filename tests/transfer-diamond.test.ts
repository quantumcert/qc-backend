// tests/transfer-diamond.test.ts
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

describe('Diamond transfer.initiate (pós-migração)', () => {
  it('✅ 200 — transfer.initiate via Diamond com asset ACTIVE', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockActiveAsset as any);
    vi.mocked(prisma.owner.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.owner.create).mockResolvedValue(mockOwner as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({
        selector: 'transfer.initiate',
        payload: {
          assetId: 'asset-1',
          buyerDocument: '123.456.789-01',
          documentType: 'CPF',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assetId).toBe('asset-1');
    expect(res.body.data.status).toBe('AWAITING_PAYMENT');
    expect(res.body.data.paymentLink).toBe('https://mp.mock/checkout/mock-preference-id');
    // Buyer document mask must be stripped
    expect(res.body.data.buyerDocument).toBe('12345678901');
  });

  it('✅ 200 — reutiliza owner existente se documento já cadastrado', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockActiveAsset as any);
    vi.mocked(prisma.owner.findFirst).mockResolvedValue(mockOwner as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({
        selector: 'transfer.initiate',
        payload: {
          assetId: 'asset-1',
          buyerDocument: '12345678901',
          documentType: 'CPF',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.buyerOwnerId).toBe('owner-1');
    // Should NOT create a new owner record
    expect(prisma.owner.create).not.toHaveBeenCalled();
  });

  it('🚫 400 — asset em estado DRAFT não pode ser transferido', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      ...mockActiveAsset,
      status: 'DRAFT',
    } as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({
        selector: 'transfer.initiate',
        payload: {
          assetId: 'asset-1',
          buyerDocument: '12345678901',
          documentType: 'CPF',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ASSET_STATE');
  });

  it('🚫 401 — sem API key', async () => {
    const res = await request(app)
      .post('/api/v1/diamond')
      .send({
        selector: 'transfer.initiate',
        payload: { assetId: 'asset-1', buyerDocument: '12345678901', documentType: 'CPF' },
      });

    expect(res.status).toBe(401);
  });

  it('✅ 400 — rota REST PATCH /api/v1/assets/:id/transfer existe e exige X-Idempotency-Key', async () => {
    // Route now exists (created in Plan 01-03 CORE-02).
    // Without X-Idempotency-Key the idempotency guard returns 400 — proves route is reachable.
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/transfer')
      .set('X-API-Key', 'qc_test_key')
      .send({ buyerDocument: '12345678901', documentType: 'CPF' });

    expect(res.status).toBe(400); // idempotency guard fires — route exists
  });
});
