/**
 * TDD RED phase — CircuitBreakerService.verifyAdminSignature (SEC-03)
 *
 * These tests verify that verifyAdminSignature uses real Falcon-512 verification
 * and enforces the CIRCUIT_BREAKER_ADMIN_PUBKEY env var in production mode.
 *
 * verifyAdminSignature is private, so we access it via TypeScript casting.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

vi.mock('../src/config/prisma', () => ({
  default: {
    panicLog: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

// We need to reset the singleton between tests that change NODE_ENV
let CircuitBreakerService: any;
let QuantumSignerService: any;

describe('CircuitBreakerService.verifyAdminSignature (SEC-03)', () => {
  beforeAll(async () => {
    const cb = await import('../src/services/CircuitBreakerService');
    const qs = await import('../src/services/QuantumSignerService');
    CircuitBreakerService = cb.CircuitBreakerService;
    QuantumSignerService = qs.QuantumSignerService;
  });

  afterEach(() => {
    // Reset the singleton so each test gets fresh state
    (CircuitBreakerService as any).instance = undefined;
    delete process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY;
    // Restore NODE_ENV to test
    process.env.NODE_ENV = 'test';
  });

  it('returns false when signature is an empty string', async () => {
    const falcon = require('falcon-crypto');
    const { publicKey } = await falcon.keyPair();
    process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY = Buffer.from(publicKey).toString('hex');

    const service = CircuitBreakerService.getInstance();
    const result = await (service as any).verifyAdminSignature('PAUSE', 'ALGORAND', '');
    expect(result).toBe(false);
  });

  it('returns false for a forged signature that does not verify against the configured pubkey', async () => {
    const falcon = require('falcon-crypto');
    const { publicKey } = await falcon.keyPair();
    process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY = Buffer.from(publicKey).toString('hex');

    const service = CircuitBreakerService.getInstance();
    const forgedSig = Buffer.from('i-am-a-forged-signature-qc').toString('base64');
    const result = await (service as any).verifyAdminSignature('PAUSE', 'ALGORAND', forgedSig);
    expect(result).toBe(false);
  });

  it('returns true for a valid Falcon-512 signature from the configured admin key', async () => {
    const falcon = require('falcon-crypto');
    const { publicKey, privateKey } = await falcon.keyPair();
    process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY = Buffer.from(publicKey).toString('hex');

    // Sign the same payload the method will construct: { action, chain }
    const payload = { action: 'PAUSE', chain: 'ALGORAND' };
    const message = JSON.stringify(payload);
    const sig = await falcon.signDetached(Buffer.from(message), privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');

    const service = CircuitBreakerService.getInstance();
    const result = await (service as any).verifyAdminSignature('PAUSE', 'ALGORAND', sigB64);
    expect(result).toBe(true);
  });

  it('throws in NODE_ENV=production when CIRCUIT_BREAKER_ADMIN_PUBKEY is not set', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY;

    const service = CircuitBreakerService.getInstance();
    await expect(
      (service as any).verifyAdminSignature('PAUSE', 'ALGORAND', 'any-sig')
    ).rejects.toThrow('CIRCUIT_BREAKER_ADMIN_PUBKEY not configured in production');
  });

  it('returns false in NODE_ENV=development when CIRCUIT_BREAKER_ADMIN_PUBKEY is not set (fail-secure)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY;

    const service = CircuitBreakerService.getInstance();
    const result = await (service as any).verifyAdminSignature('PAUSE', 'ALGORAND', 'any-sig');
    expect(result).toBe(false);
  });
});
