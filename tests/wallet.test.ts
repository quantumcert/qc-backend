// ============================================================
// WALLET CONTROLLER TESTS
// Tests for deposit-address and balance endpoints.
// ============================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import prisma from '../src/config/prisma';
import { WalletService } from '../src/services/WalletService';
import { KMSService } from '../src/services/KMSService';

// Bypass API Key auth for tests by injecting middleware override
vi.mock('../src/middleware/apiKeyAuth', () => ({
  requireApiKey: (req: any, _res: any, next: any) => {
    req.tenantId = 'test-tenant-id';
    req.apiKeyId = 'test-api-key-id';
    req.apiKeyRole = 'ADMIN';
    req.apiKeyPrefix = 'qc_test';
    next();
  },
  optionalApiKey: (_req: any, _res: any, next: any) => next(),
}));

// Mock rate limiter to not block tests
vi.mock('../src/middleware/rateLimiter', () => ({
  tenantRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

describe('Wallet API', () => {
  const TEST_TENANT_ID = 'test-tenant-id';

  beforeAll(async () => {
    // Ensure test tenant exists
    await (prisma as any).tenant.upsert({
      where: { id: TEST_TENANT_ID },
      update: {},
      create: {
        id: TEST_TENANT_ID,
        name: 'Test Tenant',
        slug: 'test-tenant',
        contactEmail: 'test@example.com',
      },
    });

    // Seed required env for KMS derivation to work in tests
    process.env.ETHEREUM_PRIVATE_KEY = '0x' + 'a'.repeat(64);
    process.env.POLYGON_PRIVATE_KEY = '0x' + 'b'.repeat(64);
    process.env.ALGORAND_MASTER_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    KMSService.getInstance().clearCache();
  });

  // ──────────────────────────────────────────────────────
  describe('GET /api/v1/wallet/deposit-address', () => {
    it('should create and return a deposit address for a given chain', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/deposit-address?chain=POLYGON')
        .set('X-API-Key', 'qc_test_dummy');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('address');
      expect(res.body.data).toHaveProperty('chain', 'POLYGON');
      expect(res.body.data.address.startsWith('0x')).toBe(true);
    });

    it('should return the same address on subsequent calls (idempotent)', async () => {
      const res1 = await request(app)
        .get('/api/v1/wallet/deposit-address?chain=POLYGON')
        .set('X-API-Key', 'qc_test_dummy');

      const res2 = await request(app)
        .get('/api/v1/wallet/deposit-address?chain=POLYGON')
        .set('X-API-Key', 'qc_test_dummy');

      expect(res1.body.data.address).toBe(res2.body.data.address);
    });

    it('should return 400 for invalid chain', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/deposit-address?chain=INVALID')
        .set('X-API-Key', 'qc_test_dummy');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────
  describe('GET /api/v1/wallet/balance', () => {
    it('should return balance (zero when no deposits)', async () => {
      const res = await request(app)
        .get('/api/v1/wallet/balance?chain=POLYGON')
        .set('X-API-Key', 'qc_test_dummy');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.balance).toBe('0');
      expect(res.body.data.chain).toBe('POLYGON');
    });

    it('should aggregate correctly with confirmed deposits', async () => {
      const ws = WalletService.getInstance();
      const wallet = await ws.getDepositAddress(TEST_TENANT_ID, 'POLYGON');

      // Manually create a confirmed deposit
      await (prisma as any).deposit.create({
        data: {
          tenantId: TEST_TENANT_ID,
          walletId: wallet.id,
          txHash: '0xdeadbeef',
          amount: '1000000000',
          currency: 'USDC',
          chain: 'POLYGON',
          status: 'CONFIRMED',
          requiredConfirmations: 12,
          confirmations: 12,
          confirmedAt: new Date(),
        },
      });

      const res = await request(app)
        .get('/api/v1/wallet/balance?chain=POLYGON')
        .set('X-API-Key', 'qc_test_dummy');

      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe('1000000000');
    });
  });
});
