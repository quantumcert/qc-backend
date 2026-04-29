import crypto from 'node:crypto';
// @ts-ignore
import { aesCmac } from 'node-aes-cmac';

export interface HaversineCheckInput {
  lat: number | null;
  lon: number | null;
  lastLat: number;
  lastLon: number;
  lastTapAt: Date;
}

export interface HaversineCheckResult {
  ok: boolean;
  speedKmh?: number;
}

export interface NtagLayoutInput {
  ntagUID: string;
  truncatedDAT: string;
  truncatedFalconHash: string;
  metadataJson: string;
}

export class QTagCryptoService {
  /**
   * Decrypts NTAG 424 DNA SDM picc_data (AES-128-ECB).
   * Returns uid (7 bytes, lowercase hex) and ctr (integer, little-endian 3 bytes).
   */
  static decryptPiccData(piccDataHex: string, sdmEncKeyHex: string): { uid: string; ctr: number } {
    if (!/^[0-9A-Fa-f]{32}$/.test(piccDataHex)) {
      throw new Error('Invalid picc_data: must be 32 hex characters');
    }
    const key = Buffer.from(sdmEncKeyHex, 'hex');
    try {
      const encrypted = Buffer.from(piccDataHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
      decipher.setAutoPadding(false);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      const uid = plaintext.slice(0, 7).toString('hex');
      // NTAG 424 DNA SDM: UID is bytes 0-6, then 1 byte padding, then 3-byte CTR little-endian
      const ctr = plaintext[7] | (plaintext[8] << 8) | (plaintext[9] << 16);

      return { uid, ctr };
    } finally {
      key.fill(0);
    }
  }

  /**
   * Computes NXP SDM CMAC: CMAC-AES(uid_bytes || ctr_LE_bytes, sdmMacKey)
   * then selects odd-index bytes (NXP SDM spec truncation).
   * Returns 8 bytes as 16 lowercase hex chars.
   */
  static computeSdmCmac(uidHex: string, ctr: number, sdmMacKeyHex: string): string {
    const key = Buffer.from(sdmMacKeyHex, 'hex');
    try {
      const uidBytes = Buffer.from(uidHex, 'hex');
      const ctrBuf = Buffer.alloc(3);
      ctrBuf.writeUIntLE(ctr, 0, 3);
      const macInput = Buffer.concat([uidBytes, ctrBuf]);

      const fullMac = Buffer.from(aesCmac(key, macInput) as string, 'hex');

      const truncated = Buffer.alloc(8);
      for (let i = 0; i < 8; i++) {
        truncated[i] = fullMac[1 + i * 2];
      }
      return truncated.toString('hex');
    } finally {
      key.fill(0);
    }
  }

  /**
   * Derives DAT (Device Authentication Token) via HKDF-SHA3-256.
   * IKM = falconHash (64 bytes) + ntagUID bytes (7 bytes)
   * Salt = ntagUID bytes, Info = "QTAG-DAT-v1"
   * Output: first 16 bytes of 32-byte derivation, as hex.
   */
  static deriveDAT(falconHashHex: string, ntagUIDHex: string): string {
    const uidBytes = Buffer.from(ntagUIDHex, 'hex');
    const falconHashBytes = Buffer.from(falconHashHex, 'hex');
    const ikm = Buffer.concat([falconHashBytes, uidBytes]);

    const derived = crypto.hkdfSync(
      'sha3-256',
      ikm,
      uidBytes,
      Buffer.from('QTAG-DAT-v1'),
      32
    );
    return Buffer.from(derived).slice(0, 16).toString('hex');
  }

  /**
   * Validates geospatial plausibility via Haversine formula.
   * Fails if speed between last and current location exceeds 1000 km/h.
   * Bypasses if: lat/lon null, or lastLat == 0 && lastLon == 0 (first tap).
   */
  static haversineCheck(input: HaversineCheckInput): HaversineCheckResult {
    const { lat, lon, lastLat, lastLon, lastTapAt } = input;

    if (lat === null || lon === null) return { ok: true };
    if (lastLat === 0 && lastLon === 0) return { ok: true };

    const R = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat - lastLat);
    const dLon = toRad(lon - lastLon);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lastLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
    const distanceKm = 2 * R * Math.asin(Math.sqrt(a));

    const elapsedMs = Date.now() - lastTapAt.getTime();
    const elapsedHours = Math.max(elapsedMs / 3_600_000, 1 / 3600);
    const speedKmh = distanceKm / elapsedHours;

    if (speedKmh > 1000) return { ok: false, speedKmh };
    return { ok: true, speedKmh };
  }

  /**
   * Builds the 144-byte NTAG 424 DNA layout buffer.
   * [0-1]   2B  Protocol version 0x0100
   * [2-9]   8B  UID (7 bytes) + 0x00 padding
   * [10-25] 16B truncatedDAT
   * [26-57] 32B truncatedFalconHash
   * [58-61] 4B  ARC-89 pointer (0x00000000, out of scope)
   * [62-95] 34B metadata checksum (SHA3-256 32B + CRC16 2B)
   * [96-143] 48B reserved 0x00
   */
  static buildNtagLayout(input: NtagLayoutInput): Buffer {
    const { ntagUID, truncatedDAT, truncatedFalconHash, metadataJson } = input;
    const layout = Buffer.alloc(144, 0);

    layout[0] = 0x01;
    layout[1] = 0x00;

    Buffer.from(ntagUID, 'hex').copy(layout, 2);
    Buffer.from(truncatedDAT, 'hex').copy(layout, 10);
    Buffer.from(truncatedFalconHash, 'hex').copy(layout, 26);

    const metaHash = crypto.createHash('sha3-256').update(metadataJson).digest();
    metaHash.copy(layout, 62);
    const crc = QTagCryptoService.crc16(metaHash);
    layout.writeUInt16BE(crc, 94);

    return layout;
  }

  /** Splits 144-byte layout into 36 pages of 4 bytes each, base64-encoded. */
  static layoutToPages(layout: Buffer): string[] {
    const pages: string[] = [];
    for (let i = 0; i < 36; i++) {
      pages.push(layout.slice(i * 4, i * 4 + 4).toString('base64'));
    }
    return pages;
  }

  /** CRC-16/CCITT-FALSE */
  private static crc16(data: Buffer): number {
    let crc = 0xffff;
    for (const byte of data) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      }
    }
    return crc & 0xffff;
  }
}
