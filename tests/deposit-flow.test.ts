// ============================================================
// DEPOSIT FLOW E2E TEST
// End-to-end test: wallet creation -> deposit detection -> balance confirmation
// ============================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import prisma from '../src/config/prisma';
import { WalletService } from '../src/services/WalletService';
import { KMSService } from '../src/services/KMSService';

// Mock auth middleware
vi.mock('../src/middleware/apiKeyAuth', () => ({
  requireApiKey: (req: any, _res: any, next: any) => {
    req.tenantId = 'e2e-tenant';
    req.apiKeyId = 'e2e-key';
    req.apiKeyRole = 'ADMIN';
    req.apiKeyPrefix = 'qc_e2e';
    next();
  },
  optionalApiKey: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/rateLimiter', () => ({
  tenantRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

describe('Deposit Flow E2E', () => {
  const TENANT_ID = 'e2e-tenant';

  beforeAll(async () => {
    // Seed env for KMS
    process.env.ETHEREUM_PRIVATE_KEY = '0x' + 'a'.repeat(64);
    process.env.POLYGON_PRIVATE_KEY = '0x' + 'b'.repeat(64);
    process.env.ALGORAND_MASTER_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    KMSService.getInstance().clearCache();

    // Ensure tenant exists
    await (prisma as any).tenant.upsert({
      where: { id: TENANT_ID },
      update: {},
      create: {
        id: TENANT_ID,
        name: 'E2E Tenant',
        slug: 'e2e-tenant',
        contactEmail: 'e2e@example.com',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await (prisma as any).deposit.deleteMany({ where: { tenantId: TENANT_ID } });
    await (prisma as any).userWallet.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  it('full flow: create wallet -> simulate deposit -> confirm -> check balance', async () => {
    // Step 1: Get deposit address (creates wallet)
    const addrRes = await request(app)
      .get('/api/v1/wallet/deposit-address?chain=POLYGON')
      .set('X-API-Key', 'qc_e2e_dummy');

    expect(addrRes.status).toBe(200);
    expect(addrRes.body.data.address).toBeDefined();
    const address = addrRes.body.data.address;

    // Step 2: Check initial balance (should be 0)
    const balRes0 = await request(app)
      .get('/api/v1/wallet/balance?chain=POLYGON')
      .set('X-API-Key', 'qc_e2e_dummy');

    expect(balRes0.body.data.balance).toBe('0');

    // Step 3: Simulate a deposit by creating a Deposit record
    const wallet = await (prisma as any).userWallet.findFirst({
      where: { tenantId: TENANT_ID, chain: 'POLYGON' },
    });

    await (prisma as any).deposit.create({
      data: {
        tenantId: TENANT_ID,
        walletId: wallet.id,
        txHash: '0xe2e-deposit-1',
        amount: '2500000000',
        currency: 'USDC',
        chain: 'POLYGON',
        status: 'CONFIRMED',
        requiredConfirmations: 12,
        confirmations: 12,
        confirmedAt: new Date(),
      },
    });

    // Step 4: Check balance after confirmed deposit
    const balRes1 = await request(app)
      .get('/api/v1/wallet/balance?chain=POLYGON')
      .set('X-API-Key', 'qc_e2e_dummy');

    expect(balRes1.status).toBe(200);
    expect(balRes1.body.data.balance).toBe('2500000000');
    expect(balRes1.body.data.totalDeposited).toBe('2500000000');
    expect(balRes1.body.data.depositCount).toBe(1);
  });
});
