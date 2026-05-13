import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockEncodingSession, mockDevice, mockEventLog, mockKmsGetTenantSecretHex, mockKmsWrapUserKey } = vi.hoisted(() => {
  const mockEncodingSession = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const mockDevice = {
    upsert: vi.fn(),
  };
  const mockEventLog = {
    create: vi.fn(),
  };
  const mockKmsGetTenantSecretHex = vi.fn();
  const mockKmsWrapUserKey = vi.fn();
  return { mockEncodingSession, mockDevice, mockEventLog, mockKmsGetTenantSecretHex, mockKmsWrapUserKey };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    encodingSession: mockEncodingSession,
    device: mockDevice,
    eventLog: mockEventLog,
  },
}));

vi.mock('../src/services/QuantumSignerService', () => ({
  QuantumSignerService: {
    getInstance: () => ({
      signPayload: vi.fn().mockResolvedValue({
        pqcProof: { signature: Buffer.alloc(64).toString('base64'), timestamp: 0, entityId: 'a1', entityType: 'ASSET' },
        payloadHash: 'a'.repeat(128),
      }),
    }),
  },
}));

vi.mock('../src/services/KMSService', () => ({
  KMSService: {
    getInstance: () => ({
      getTenantSecretHex: mockKmsGetTenantSecretHex,
      wrapUserKey: mockKmsWrapUserKey,
      unwrapUserKey: vi.fn((k: string) => k.replace('wrapped:', '')),
    }),
  },
}));

import { CommissioningFacet } from '../src/services/core-facets/CommissioningFacet';

const ctx = { tenantId: 'tenant-1', apiKeyId: 'key-1', role: 'OPERATOR' as const };
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('CommissioningFacet.start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKmsGetTenantSecretHex.mockResolvedValue('f'.repeat(4610));
    mockKmsWrapUserKey.mockImplementation((k: string) => `wrapped:${k}`);
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('creates EncodingSession and returns layout + sdmMacKey', async () => {
    mockEncodingSession.create.mockResolvedValue({
      id: 'session-1',
      layoutB64: Buffer.alloc(144).toString('base64'),
      sdmMacKeyId: 'wrapped:aabb',
      sdmEncKeyId: 'wrapped:ccdd',
    });
    mockEventLog.create.mockResolvedValue({ id: 'log-1' });

    const result = await CommissioningFacet.start(ctx, {
      assetId: 'asset-1',
      ntagUID: '04AABBCCDDEE11',
      metadata: { type: 'ring' },
    });

    expect(result.sessionId).toBe('session-1');
    expect(result.pages).toHaveLength(36);
    expect(typeof result.sdmMacKey).toBe('string');
    expect(result.sdmMacKey).toHaveLength(32); // 16 bytes hex
    expect(result.writeKey).toHaveLength(32);
    expect(result.lockAfterWrite).toBe(false);
    expect(mockKmsGetTenantSecretHex).toHaveBeenCalledWith('tenant-1', 'qtag-commissioning');
    expect(mockEncodingSession.create).toHaveBeenCalledOnce();
    expect(mockEventLog.create).toHaveBeenCalledOnce();
  });

  it('does not persist plaintext one-time SDM or write keys', async () => {
    mockEncodingSession.create.mockResolvedValue({
      id: 'session-plain-check',
      layoutB64: Buffer.alloc(144).toString('base64'),
      sdmMacKeyId: 'wrapped:aabb',
      sdmEncKeyId: 'wrapped:ccdd',
    });
    mockEventLog.create.mockResolvedValue({ id: 'log-plain-check' });

    const result = await CommissioningFacet.start(ctx, {
      assetId: 'asset-plain-check',
      ntagUID: '04AABBCCDDEE11',
      metadata: { type: 'ring' },
    });

    const sessionData = mockEncodingSession.create.mock.calls[0][0].data;
    expect(result.sdmMacKey).toHaveLength(32);
    expect(result.writeKey).toHaveLength(32);
    expect(sessionData).toHaveProperty('sdmMacKeyId');
    expect(sessionData).toHaveProperty('sdmEncKeyId');
    expect(sessionData).not.toHaveProperty('sdmMacKey');
    expect(sessionData).not.toHaveProperty('writeKey');
    expect(sessionData).not.toHaveProperty('sdmMacKeyPlain');
    expect(sessionData).not.toHaveProperty('writeKeyPlain');
  });

  it('returns lockAfterWrite=true in production', async () => {
    process.env.NODE_ENV = 'production';
    mockEncodingSession.create.mockResolvedValue({
      id: 'session-prod',
      layoutB64: Buffer.alloc(144).toString('base64'),
      sdmMacKeyId: 'wrapped:aabb',
      sdmEncKeyId: 'wrapped:ccdd',
    });
    mockEventLog.create.mockResolvedValue({ id: 'log-prod' });

    const result = await CommissioningFacet.start(ctx, {
      assetId: 'asset-prod',
      ntagUID: '04AABBCCDDEE11',
      metadata: {},
    });

    expect(result.lockAfterWrite).toBe(true);
  });

  it('fails closed without creating event or session when tenant secret is missing', async () => {
    mockKmsGetTenantSecretHex.mockRejectedValueOnce(
      Object.assign(new Error('Tenant secret not configured for commissioning'), {
        code: 'TENANT_SECRET_NOT_CONFIGURED',
      })
    );

    await expect(
      CommissioningFacet.start(ctx, {
        assetId: 'asset-1',
        ntagUID: '04AABBCCDDEE11',
        metadata: { type: 'ring' },
      })
    ).rejects.toMatchObject({ code: 'TENANT_SECRET_NOT_CONFIGURED' });

    expect(mockEventLog.create).not.toHaveBeenCalled();
    expect(mockEncodingSession.create).not.toHaveBeenCalled();
  });

  it('throws if ntagUID is not 14 hex chars', async () => {
    await expect(
      CommissioningFacet.start(ctx, { assetId: 'asset-1', ntagUID: 'INVALID', metadata: {} })
    ).rejects.toThrow('Invalid ntagUID');
  });

  it('ntagUID is normalized to lowercase', async () => {
    mockEncodingSession.create.mockResolvedValue({
      id: 'session-2',
      layoutB64: Buffer.alloc(144).toString('base64'),
      sdmMacKeyId: 'wrapped:aabb',
      sdmEncKeyId: 'wrapped:ccdd',
    });
    mockEventLog.create.mockResolvedValue({ id: 'log-2' });

    await CommissioningFacet.start(ctx, {
      assetId: 'asset-2',
      ntagUID: '04AABBCCDDEE11',
      metadata: {},
    });

    const createCall = mockEncodingSession.create.mock.calls[0][0];
    expect(createCall.data.ntagUID).toBe('04aabbccddee11');
  });
});

describe('CommissioningFacet.confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks session COMPLETED and upserts Device on success=true', async () => {
    mockEncodingSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tenantId: 'tenant-1',
      assetId: 'asset-1',
      ntagUID: '04aabbccddee11',
      status: 'IN_PROGRESS',
      sdmMacKeyId: 'wrapped:aabb',
      sdmEncKeyId: 'wrapped:ccdd',
    });
    mockEncodingSession.update.mockResolvedValue({ id: 'session-1', status: 'COMPLETED' });
    mockDevice.upsert.mockResolvedValue({ id: 'device-1' });

    const result = await CommissioningFacet.confirm(ctx, {
      sessionId: 'session-1',
      success: true,
      bytesWritten: 144,
      ntagUID: '04aabbccddee11',
    });

    expect(result.status).toBe('COMPLETED');
    expect(mockDevice.upsert).toHaveBeenCalledOnce();
    expect(mockEncodingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('marks session FAILED and skips Device upsert on success=false', async () => {
    mockEncodingSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tenantId: 'tenant-1',
      status: 'IN_PROGRESS',
    });
    mockEncodingSession.update.mockResolvedValue({ id: 'session-1', status: 'FAILED' });

    const result = await CommissioningFacet.confirm(ctx, {
      sessionId: 'session-1',
      success: false,
      bytesWritten: 0,
      ntagUID: '04aabbccddee11',
    });

    expect(result.status).toBe('FAILED');
    expect(mockDevice.upsert).not.toHaveBeenCalled();
  });

  it('throws if session belongs to different tenant', async () => {
    mockEncodingSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tenantId: 'OTHER',
      status: 'IN_PROGRESS',
    });
    await expect(
      CommissioningFacet.confirm(ctx, { sessionId: 'session-1', success: true, bytesWritten: 144, ntagUID: '04aabbccddee11' })
    ).rejects.toThrow('Session not found');
  });

  it('throws if session not found', async () => {
    mockEncodingSession.findUnique.mockResolvedValue(null);
    await expect(
      CommissioningFacet.confirm(ctx, { sessionId: 'ghost', success: true, bytesWritten: 144, ntagUID: '04aabbccddee11' })
    ).rejects.toThrow('Session not found');
  });
});

describe('CommissioningFacet.statusQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session status', async () => {
    mockEncodingSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tenantId: 'tenant-1',
      status: 'COMPLETED',
      ntagUID: '04aabbccddee11',
      assetId: 'asset-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await CommissioningFacet.statusQuery(ctx, { sessionId: 'session-1' });
    expect(result.status).toBe('COMPLETED');
    expect(result.sessionId).toBe('session-1');
  });

  it('throws if session not found or wrong tenant', async () => {
    mockEncodingSession.findUnique.mockResolvedValue(null);
    await expect(
      CommissioningFacet.statusQuery(ctx, { sessionId: 'ghost' })
    ).rejects.toThrow('Session not found');
  });

  it('throws if session belongs to different tenant', async () => {
    mockEncodingSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tenantId: 'OTHER',
      status: 'COMPLETED',
      ntagUID: '04aabbccddee11',
      assetId: 'asset-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      CommissioningFacet.statusQuery(ctx, { sessionId: 'session-1' })
    ).rejects.toThrow('Session not found');
  });
});
