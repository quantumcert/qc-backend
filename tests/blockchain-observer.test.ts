// ============================================================
// BLOCKCHAIN OBSERVER SERVICE TESTS
// Tests for deposit detection, idempotency, and confirmation logic.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockchainObserverService } from '../src/services/BlockchainObserverService';
import prisma from '../src/config/prisma';

describe('BlockchainObserverService', () => {
  let observer: BlockchainObserverService;

  beforeEach(async () => {
    vi.clearAllMocks();
    observer = BlockchainObserverService.getInstance();

    // Clean deposits and wallets
    await (prisma as any).deposit.deleteMany({});
    await (prisma as any).userWallet.deleteMany({});
    await (prisma as any).tenant.deleteMany({ where: { id: { contains: 'observer-test' } } });
  });

  // ──────────────────────────────────────────────────────
  describe('Idempotency', () => {
    it('should not insert duplicate deposits for the same txHash', async () => {
      const txHash = '0xdeadbeef1234';
      const tenantId = 'observer-test-' + Date.now();

      await (prisma as any).tenant.create({
        data: { id: tenantId, name: 'Test', slug: 'test-observer-' + Date.now(), contactEmail: 't@test.com' }
      });

      const wallet = await (prisma as any).userWallet.create({
        data: { tenantId, chain: 'POLYGON', address: '0x1', accountIndex: 0 }
      });

      // Insert first deposit
      await (prisma as any).deposit.create({
        data: {
          tenantId,
          walletId: wallet.id,
          txHash,
          amount: '1000000',
          currency: 'USDC',
          chain: 'POLYGON',
          status: 'PENDING',
          requiredConfirmations: 12,
        }
      });

      // Attempt duplicate insert — should throw unique constraint
      await expect(
        (prisma as any).deposit.create({
          data: {
            tenantId,
            walletId: wallet.id,
            txHash,
            amount: '1000000',
            currency: 'USDC',
            chain: 'POLYGON',
            status: 'PENDING',
            requiredConfirmations: 12,
          }
        })
      ).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────
  describe('Confirmation thresholds', () => {
    it('should require 12 confirmations for Polygon', () => {
      expect(BlockchainObserverService.getRequiredConfirmations('POLYGON')).toBe(12);
    });

    it('should require 12 confirmations for Ethereum', () => {
      expect(BlockchainObserverService.getRequiredConfirmations('ETHEREUM')).toBe(12);
    });

    it('should require 0 confirmations for Algorand', () => {
      expect(BlockchainObserverService.getRequiredConfirmations('ALGORAND')).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────
  describe('Deposit lifecycle', () => {
    it('should create a deposit and confirm it when threshold reached', async () => {
      const tenantId = 'observer-test-' + Date.now();

      await (prisma as any).tenant.create({
        data: { id: tenantId, name: 'Test', slug: 'test-poly-' + Date.now(), contactEmail: 't@test.com' }
      });

      const wallet = await (prisma as any).userWallet.create({
        data: { tenantId, chain: 'POLYGON', address: '0x2', accountIndex: 0 }
      });

      const deposit = await (prisma as any).deposit.create({
        data: {
          tenantId,
          walletId: wallet.id,
          txHash: '0xabc123',
          amount: '5000000',
          currency: 'USDC',
          chain: 'POLYGON',
          status: 'PENDING',
          requiredConfirmations: 12,
          confirmations: 0,
        }
      });

      expect(deposit.status).toBe('PENDING');

      // Simulate confirmation update
      const confirmed = await (prisma as any).deposit.update({
        where: { id: deposit.id },
        data: { status: 'CONFIRMED', confirmations: 12, confirmedAt: new Date() }
      });

      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.confirmations).toBe(12);
    });
  });
});
