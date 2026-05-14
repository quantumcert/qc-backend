import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

vi.mock('../src/config/prisma', () => ({
  default: {
    device: { findFirst: vi.fn(), update: vi.fn() },
    deviceTapLog: { create: vi.fn() },
    asset: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../src/services/KMSService', () => ({
  KMSService: {
    getInstance: () => ({
      unwrapUserKey: vi.fn((k: string) => k.replace('wrapped:', '')),
    }),
  },
}));

import { SDMVerifierService } from '../src/services/SDMVerifierService';
import { QTagCryptoService } from '../src/services/QTagCryptoService';
import prisma from '../src/config/prisma';
import apiRouter from '../src/routes/index';

const mockDevice = prisma.device as any;
const mockDeviceTapLog = prisma.deviceTapLog as any;
const mockAsset = prisma.asset as any;
const mockTransaction = (prisma as any).$transaction as ReturnType<typeof vi.fn>;

const ENC_KEY = '00'.repeat(16);
const MAC_KEY = '00'.repeat(16);
const UID = '04aabbccddee00';

const createApiApp = () => {
  const app = express();
  app.use('/api', apiRouter);
  return app;
};

function buildPiccData(uid: string, ctr: number, encKeyHex: string): string {
  const plain = Buffer.alloc(16, 0);
  Buffer.from(uid, 'hex').copy(plain, 0);
  plain.writeUIntLE(ctr, 7, 3);
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(encKeyHex, 'hex'), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString('hex');
}

const deviceRecord = (overrides: Partial<any> = {}) => ({
  id: 'dev-1',
  uid: UID,
  tenantId: 'tenant-1',
  isActive: true,
  lastCounter: 4,
  lastTapAt: new Date(Date.now() - 60_000),
  lastLat: 0,
  lastLon: 0,
  sdmEncKeyId: `wrapped:${ENC_KEY}`,
  sdmMacKeyId: `wrapped:${MAC_KEY}`,
  totalTaps: 10,
  ...overrides,
});

describe('SDMVerifierService.verifyTap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns APPROVED for valid tap', async () => {
    const ctr = 5;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    const cmac = QTagCryptoService.computeSdmCmac(UID, ctr, MAC_KEY);

    mockDevice.findFirst.mockResolvedValue(deviceRecord());
    mockAsset.findFirst.mockResolvedValue({
      id: 'asset-1',
      publicDataKeys: ['type'],
      metadata: { type: 'ring', secret: 'hidden' },
      status: 'ACTIVE',
      events: [{ dltTxId: 'ALGO_TX_123', blockHeight: 1000 }],
    });
    mockTransaction.mockImplementation(async (ops: any[]) => Promise.all(ops.map((op: any) => Promise.resolve(op))));

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: cmac,
      lat: null,
      lon: null,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('APPROVED');
    expect(result.counter).toBe(5);
    expect(result.asset).toBeDefined();
    expect(result.asset!.metadata).toEqual({ type: 'ring' });
    expect(result.asset!.metadata).not.toHaveProperty('secret');
  });

  it('returns DENIED/MAC_INVALID for wrong CMAC', async () => {
    const ctr = 5;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    mockDevice.findFirst.mockResolvedValue(deviceRecord());

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: 'deadbeefdeadbeef',
      lat: null,
      lon: null,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('DENIED');
    expect(result.reason).toBe('MAC_INVALID');
    expect(mockDeviceTapLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        counterValue: 5,
        cmacReceived: 'deadbeefdeadbeef',
        cmacValid: false,
        verdict: 'CMAC_INVALID',
        ipAddress: '127.0.0.1',
      }),
    });
  });

  it('returns DENIED/REPLAY_ATTACK when ctr <= lastCounter', async () => {
    const ctr = 3;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    const cmac = QTagCryptoService.computeSdmCmac(UID, ctr, MAC_KEY);
    mockDevice.findFirst.mockResolvedValue(deviceRecord({ lastCounter: 4 }));

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: cmac,
      lat: null,
      lon: null,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('DENIED');
    expect(result.reason).toBe('REPLAY_ATTACK');
    expect(mockDeviceTapLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        counterValue: 3,
        cmacReceived: cmac,
        cmacValid: true,
        verdict: 'REPLAY_BLOCKED',
        ipAddress: '127.0.0.1',
      }),
    });
  });

  it('returns DENIED/DEVICE_NOT_FOUND when device is null', async () => {
    const ctr = 1;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    const cmac = QTagCryptoService.computeSdmCmac(UID, ctr, MAC_KEY);
    mockDevice.findFirst.mockResolvedValue(null);

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: cmac,
      lat: null,
      lon: null,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('DENIED');
    expect(result.reason).toBe('DEVICE_NOT_FOUND');
    expect(mockDeviceTapLog.create).not.toHaveBeenCalled();
  });

  it('returns DENIED/DEVICE_INACTIVE for inactive device', async () => {
    const ctr = 5;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    const cmac = QTagCryptoService.computeSdmCmac(UID, ctr, MAC_KEY);
    mockDevice.findFirst.mockResolvedValue(deviceRecord({ isActive: false }));

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: cmac,
      lat: null,
      lon: null,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('DENIED');
    expect(result.reason).toBe('DEVICE_INACTIVE');
    expect(mockDeviceTapLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        counterValue: 0,
        cmacReceived: cmac,
        cmacValid: false,
        verdict: 'DEVICE_INACTIVE',
        ipAddress: '127.0.0.1',
      }),
    });
  });

  it('throws INVALID_INPUT for malformed picc_data', async () => {
    await expect(
      SDMVerifierService.verifyTap({
        piccDataHex: 'ZZZZ',
        cmacHex: 'aaaa',
        lat: null,
        lon: null,
        ip: '1.2.3.4',
        uidHex: UID,
      })
    ).rejects.toThrow('INVALID_INPUT');
  });

  it('returns DENIED/RELAY_ATTACK for impossible geolocation', async () => {
    const ctr = 5;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    const cmac = QTagCryptoService.computeSdmCmac(UID, ctr, MAC_KEY);
    mockDevice.findFirst.mockResolvedValue(deviceRecord({
      lastLat: -23.5505,
      lastLon: -46.6333,
      lastTapAt: new Date(Date.now() - 60_000),
    }));

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: cmac,
      lat: 35.6762,
      lon: 139.6503,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('DENIED');
    expect(result.reason).toBe('RELAY_ATTACK');
    expect(mockDeviceTapLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        counterValue: 5,
        cmacReceived: cmac,
        cmacValid: true,
        verdict: 'RELAY_ATTACK',
        ipAddress: '127.0.0.1',
      }),
    });
  });

  it('filters metadata to only publicDataKeys', async () => {
    const ctr = 5;
    const piccDataHex = buildPiccData(UID, ctr, ENC_KEY);
    const cmac = QTagCryptoService.computeSdmCmac(UID, ctr, MAC_KEY);

    mockDevice.findFirst.mockResolvedValue(deviceRecord());
    mockAsset.findFirst.mockResolvedValue({
      id: 'asset-1',
      publicDataKeys: ['brand'],
      metadata: { brand: 'QC', serial: 'PRIVATE', owner: 'PRIVATE' },
      status: 'ACTIVE',
      events: [],
    });
    mockTransaction.mockImplementation(async (ops: any[]) => Promise.all(ops.map((op: any) => Promise.resolve(op))));

    const result = await SDMVerifierService.verifyTap({
      piccDataHex,
      cmacHex: cmac,
      lat: null,
      lon: null,
      ip: '127.0.0.1',
      uidHex: UID,
    });

    expect(result.status).toBe('APPROVED');
    expect(result.asset!.metadata).toEqual({ brand: 'QC' });
  });
});

describe('GET /api/v1/scan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when p or m is missing', async () => {
    const response = await request(createApiApp()).get('/api/v1/scan?p=abcd');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing required parameters: p, m' });
  });

  it('returns 403 and preserves DENIED body from SDMVerifierService', async () => {
    const verifyTapSpy = vi.spyOn(SDMVerifierService, 'verifyTap').mockResolvedValue({
      status: 'DENIED',
      reason: 'MAC_INVALID',
      message: 'Assinatura inválida.',
    });

    const response = await request(createApiApp()).get(`/api/v1/scan?p=${'0'.repeat(32)}&m=${'0'.repeat(16)}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      status: 'DENIED',
      reason: 'MAC_INVALID',
      message: 'Assinatura inválida.',
    });
    verifyTapSpy.mockRestore();
  });

  it('returns 400 when verifier rejects malformed NFC parameters', async () => {
    const verifyTapSpy = vi.spyOn(SDMVerifierService, 'verifyTap').mockRejectedValue(new Error('INVALID_INPUT'));

    const response = await request(createApiApp()).get(`/api/v1/scan?p=${'0'.repeat(32)}&m=${'0'.repeat(16)}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid NFC parameters.' });
    verifyTapSpy.mockRestore();
  });

  it('returns 200 when verifier approves a tap', async () => {
    const verifyTapSpy = vi.spyOn(SDMVerifierService, 'verifyTap').mockResolvedValue({
      status: 'APPROVED',
      counter: 5,
    });

    const response = await request(createApiApp()).get(`/api/v1/scan?p=${'0'.repeat(32)}&m=${'0'.repeat(16)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'APPROVED',
      counter: 5,
    });
    verifyTapSpy.mockRestore();
  });
});
