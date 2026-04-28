import { describe, it, expect } from 'vitest';
import { QTagCryptoService } from '../src/services/QTagCryptoService';

describe('QTagCryptoService', () => {

  describe('decryptPiccData', () => {
    it('decrypts picc_data and returns uid + ctr', () => {
      const key = Buffer.alloc(16, 0);
      const plaintext = Buffer.from('04AABBCCDDEE00010000000000000000', 'hex');
      const crypto = require('node:crypto');
      const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
      cipher.setAutoPadding(false);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const piccDataHex = encrypted.toString('hex');

      const result = QTagCryptoService.decryptPiccData(piccDataHex, key.toString('hex'));
      expect(result.uid).toBe('04aabbccddee00');
      expect(result.ctr).toBe(1);
    });

    it('throws on malformed picc_data (not 32 hex chars)', () => {
      expect(() =>
        QTagCryptoService.decryptPiccData('ZZZZ', '00'.repeat(16))
      ).toThrow('Invalid picc_data');
    });
  });

  describe('computeSdmCmac', () => {
    it('returns 16-char hex (8 bytes odd-index truncated CMAC)', () => {
      const uid = '04aabbccddee00';
      const ctr = 1;
      const key = '00'.repeat(16);
      const result = QTagCryptoService.computeSdmCmac(uid, ctr, key);
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces different CMAC for different CTR', () => {
      const uid = '04aabbccddee00';
      const key = '00'.repeat(16);
      const cmac1 = QTagCryptoService.computeSdmCmac(uid, 1, key);
      const cmac2 = QTagCryptoService.computeSdmCmac(uid, 2, key);
      expect(cmac1).not.toBe(cmac2);
    });
  });

  describe('deriveDAT', () => {
    it('derives a 32-char hex (16 bytes) DAT', () => {
      const falconHash = Buffer.alloc(64, 0xAB).toString('hex');
      const ntagUID = '04aabbccddee00';
      const result = QTagCryptoService.deriveDAT(falconHash, ntagUID);
      expect(result).toMatch(/^[0-9a-f]{32}$/);
    });

    it('produces different DAT for different UID', () => {
      const falconHash = Buffer.alloc(64, 0xAB).toString('hex');
      const dat1 = QTagCryptoService.deriveDAT(falconHash, '04aabbccddee00');
      const dat2 = QTagCryptoService.deriveDAT(falconHash, '04aabbccddee01');
      expect(dat1).not.toBe(dat2);
    });
  });

  describe('haversineCheck', () => {
    it('passes when lastLat and lastLon are 0 (first tap)', () => {
      const result = QTagCryptoService.haversineCheck({
        lat: -23.5505, lon: -46.6333,
        lastLat: 0, lastLon: 0,
        lastTapAt: new Date(Date.now() - 60_000),
      });
      expect(result.ok).toBe(true);
    });

    it('passes for nearby location', () => {
      const result = QTagCryptoService.haversineCheck({
        lat: -23.5505, lon: -46.6333,
        lastLat: -23.5510, lastLon: -46.6340,
        lastTapAt: new Date(Date.now() - 60_000),
      });
      expect(result.ok).toBe(true);
    });

    it('fails for impossible travel (São Paulo → Tokyo in 1 minute)', () => {
      const result = QTagCryptoService.haversineCheck({
        lat: 35.6762, lon: 139.6503,
        lastLat: -23.5505, lastLon: -46.6333,
        lastTapAt: new Date(Date.now() - 60_000),
      });
      expect(result.ok).toBe(false);
      expect(result.speedKmh).toBeGreaterThan(1000);
    });

    it('passes when no lat/lon provided (geo is optional)', () => {
      const result = QTagCryptoService.haversineCheck({
        lat: null, lon: null,
        lastLat: 0, lastLon: 0,
        lastTapAt: new Date(),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('buildNtagLayout', () => {
    it('builds a 144-byte buffer', () => {
      const layout = QTagCryptoService.buildNtagLayout({
        ntagUID: '04aabbccddee00',
        truncatedDAT: Buffer.alloc(16, 0xCD).toString('hex'),
        truncatedFalconHash: Buffer.alloc(32, 0xEF).toString('hex'),
        metadataJson: '{}',
      });
      expect(layout.length).toBe(144);
    });

    it('starts with protocol version 0x0100', () => {
      const layout = QTagCryptoService.buildNtagLayout({
        ntagUID: '04aabbccddee00',
        truncatedDAT: Buffer.alloc(16, 0xCD).toString('hex'),
        truncatedFalconHash: Buffer.alloc(32, 0xEF).toString('hex'),
        metadataJson: '{}',
      });
      expect(layout[0]).toBe(0x01);
      expect(layout[1]).toBe(0x00);
    });

    it('layoutToPages returns 36 pages of 4 bytes each', () => {
      const layout = QTagCryptoService.buildNtagLayout({
        ntagUID: '04aabbccddee00',
        truncatedDAT: Buffer.alloc(16, 0xCD).toString('hex'),
        truncatedFalconHash: Buffer.alloc(32, 0xEF).toString('hex'),
        metadataJson: '{}',
      });
      const pages = QTagCryptoService.layoutToPages(layout);
      expect(pages).toHaveLength(36);
      pages.forEach(p => {
        expect(Buffer.from(p, 'base64').length).toBe(4);
      });
    });
  });
});
