import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTenantSecret } = vi.hoisted(() => ({
  mockTenantSecret: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    tenantSecret: mockTenantSecret,
  },
}));

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
    mockTenantSecret.upsert.mockReset();
    mockTenantSecret.findUnique.mockReset();
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

describe('KMSService tenant-scoped secrets (QTAG-01)', () => {
  beforeEach(() => {
    resetKmsSingleton();
    mockTenantSecret.upsert.mockReset();
    mockTenantSecret.findUnique.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.QUANTUM_CERT_SECRET = 's'.repeat(64);
    process.env.NODE_ENV = 'test';
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

  it('rejects Falcon tenant secrets shorter than 4610 hex chars', async () => {
    const kms = KMSService.getInstance();

    await expect(
      kms.storeTenantSecretHex('tenant-1', 'qtag-commissioning', 'f'.repeat(4609))
    ).rejects.toThrow('Falcon-512 private key');

    expect(mockTenantSecret.upsert).not.toHaveBeenCalled();
  });

  it('stores only wrapped tenant secret material', async () => {
    const kms = KMSService.getInstance();
    const secretHex = 'f'.repeat(4610);

    await kms.storeTenantSecretHex('tenant-1', 'qtag-commissioning', secretHex, 'public-key-b64');

    expect(mockTenantSecret.upsert).toHaveBeenCalledOnce();
    const upsertArg = mockTenantSecret.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      tenantId_purpose: { tenantId: 'tenant-1', purpose: 'qtag-commissioning' },
    });
    expect(upsertArg.create).toMatchObject({
      tenantId: 'tenant-1',
      purpose: 'qtag-commissioning',
      keyType: 'FALCON-512',
      publicKeyB64: 'public-key-b64',
      keyWrapVersion: 1,
      isActive: true,
    });
    expect(upsertArg.create.encryptedSecret).toBeTypeOf('string');
    expect(upsertArg.create.encryptedSecret).not.toBe(secretHex);
    expect(upsertArg.create).not.toHaveProperty('secretHex');
  });

  it('returns tenant secret plaintext only after unwrap in memory', async () => {
    const kms = KMSService.getInstance();
    const secretHex = 'f'.repeat(4610);
    const encryptedSecret = kms.wrapUserKey(secretHex);
    mockTenantSecret.findUnique.mockResolvedValue({ encryptedSecret, isActive: true });

    const result = await kms.getTenantSecretHex('tenant-1', 'qtag-commissioning');

    expect(result).toBe(secretHex);
    expect(mockTenantSecret.findUnique).toHaveBeenCalledWith({
      where: { tenantId_purpose: { tenantId: 'tenant-1', purpose: 'qtag-commissioning' } },
    });
  });

  it('fails closed when tenant secret is missing or inactive', async () => {
    const kms = KMSService.getInstance();
    mockTenantSecret.findUnique.mockResolvedValue(null);

    await expect(kms.getTenantSecretHex('tenant-1', 'qtag-commissioning')).rejects.toMatchObject({
      code: 'TENANT_SECRET_NOT_CONFIGURED',
    });

    mockTenantSecret.findUnique.mockResolvedValue({ encryptedSecret: 'unused', isActive: false });
    await expect(kms.getTenantSecretHex('tenant-1', 'qtag-commissioning')).rejects.toMatchObject({
      code: 'TENANT_SECRET_NOT_CONFIGURED',
    });
  });
});
