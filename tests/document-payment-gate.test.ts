import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockEventLog, mockChainTransaction } = vi.hoisted(() => ({
  mockEventLog: {
    findFirst: vi.fn(),
  },
  mockChainTransaction: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    eventLog: mockEventLog,
    chainTransaction: mockChainTransaction,
  },
}));

import publicRoutes from '../src/routes/v1/publicRoutes';

const VALID_HASH = 'a'.repeat(128);
const ORIGINAL_X402_ENABLED = process.env.X402_ENABLED;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/public', publicRoutes);
  app.get('/api/v1/scan', (_req, res) => {
    res.status(200).json({ success: true, route: 'scan' });
  });
  return app;
}

describe('document payment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.X402_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_X402_ENABLED === undefined) {
      delete process.env.X402_ENABLED;
    } else {
      process.env.X402_ENABLED = ORIGINAL_X402_ENABLED;
    }
  });

  it('is disabled by default and lets document verification return its normal 404', async () => {
    mockEventLog.findFirst.mockResolvedValue(null);

    const response = await request(createApp()).get(
      `/api/v1/public/verify/document/${VALID_HASH}`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      code: 'DOCUMENT_NOT_FOUND',
    });
    expect(mockEventLog.findFirst).toHaveBeenCalledOnce();
  });

  it('keeps the route free when X402_ENABLED=false', async () => {
    process.env.X402_ENABLED = 'false';
    const updatedAt = new Date();
    mockEventLog.findFirst.mockResolvedValue({
      id: 'evt_001',
      assetId: 'asset_001',
      issuerId: null,
      dltTxId: null,
      updatedAt,
      asset: { status: 'ACTIVE', publicUrl: null },
    });
    mockChainTransaction.findFirst.mockResolvedValue(null);

    const response = await request(createApp()).get(
      `/api/v1/public/verify/document/${VALID_HASH}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verified: true,
      assetId: 'asset_001',
      blockchain: null,
    });
  });

  it('fails closed when X402_ENABLED=true and no provider is implemented', async () => {
    process.env.X402_ENABLED = 'true';

    const response = await request(createApp()).get(
      `/api/v1/public/verify/document/${VALID_HASH}`,
    );

    expect(response.status).toBe(501);
    expect(response.body).toEqual({
      success: false,
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      error: 'Document verification payment provider is not configured.',
    });
    expect(mockEventLog.findFirst).not.toHaveBeenCalled();
  });

  it('does not gate the public scan route', async () => {
    process.env.X402_ENABLED = 'true';

    const response = await request(createApp()).get('/api/v1/scan');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, route: 'scan' });
  });
});
