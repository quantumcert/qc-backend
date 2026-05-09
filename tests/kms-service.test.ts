import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KMSService } from '../src/services/KMSService';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_VITEST = process.env.VITEST;
const ORIGINAL_QUANTUM_CERT_SECRET = process.env.QUANTUM_CERT_SECRET;

function resetKmsSingleton() {
  (KMSService as any).instance = undefined;
}

describe('KMSService quantum master key (SEC-01)', () => {
  beforeEach(() => {
    resetKmsSingleton();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_VITEST === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = ORIGINAL_VITEST;
    }
    if (ORIGINAL_QUANTUM_CERT_SECRET === undefined) {
      delete process.env.QUANTUM_CERT_SECRET;
    } else {
      process.env.QUANTUM_CERT_SECRET = ORIGINAL_QUANTUM_CERT_SECRET;
    }
    vi.restoreAllMocks();
    resetKmsSingleton();
  });

  it('derives the same master key from the same QUANTUM_CERT_SECRET after cache clear', () => {
    process.env.QUANTUM_CERT_SECRET = 'q'.repeat(64);

    const kms = KMSService.getInstance();
    const first = Buffer.from(kms.getQuantumMasterKey());

    kms.clearMasterKeyCache();
    const second = Buffer.from(kms.getQuantumMasterKey());

    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
  });

  it('refuses to generate an ephemeral master key outside test mode', () => {
    delete process.env.QUANTUM_CERT_SECRET;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';

    expect(() => KMSService.getInstance().getQuantumMasterKey()).toThrow(
      'QUANTUM_CERT_SECRET is required'
    );
  });

  it('zeroizes the cached master key bytes in place before dropping the reference', () => {
    process.env.QUANTUM_CERT_SECRET = 'z'.repeat(64);

    const kms = KMSService.getInstance();
    const cached = kms.getQuantumMasterKey();
    expect([...cached].some(byte => byte !== 0)).toBe(true);

    kms.clearMasterKeyCache();

    expect([...cached].every(byte => byte === 0)).toBe(true);
  });
});
