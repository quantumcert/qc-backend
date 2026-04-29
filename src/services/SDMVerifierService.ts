import crypto from 'node:crypto';
import prisma from '../config/prisma';
import { KMSService } from './KMSService';
import { QTagCryptoService } from './QTagCryptoService';

export interface VerifyTapInput {
  piccDataHex: string;
  cmacHex: string;
  lat: number | null;
  lon: number | null;
  ip: string;
  uidHex?: string; // optional plaintext UID hint from &uid= query param
}

type DeniedReason = 'MAC_INVALID' | 'REPLAY_ATTACK' | 'RELAY_ATTACK' | 'DEVICE_NOT_FOUND' | 'DEVICE_INACTIVE';

export interface TapResult {
  status: 'APPROVED' | 'DENIED';
  counter?: number;
  reason?: DeniedReason;
  message?: string;
  asset?: {
    id: string;
    publicUrl: string;
    metadata: Record<string, unknown>;
    anchorTxId?: string;
    blockHeight?: number;
    status: string;
  };
}

const DENY_MESSAGES: Record<DeniedReason, string> = {
  MAC_INVALID: 'Assinatura inválida.',
  REPLAY_ATTACK: 'Link clonado ou expirado.',
  RELAY_ATTACK: 'Anomalia de geolocalização.',
  DEVICE_NOT_FOUND: 'Tag não registrada.',
  DEVICE_INACTIVE: 'Tag desativada.',
};

export class SDMVerifierService {
  static async verifyTap(input: VerifyTapInput): Promise<TapResult> {
    const { piccDataHex, cmacHex, lat, lon, ip, uidHex } = input;

    // ── Layer 0: Strict sanitization before any crypto ────────────
    if (!/^[0-9A-Fa-f]{32}$/.test(piccDataHex) || !/^[0-9A-Fa-f]{16}$/.test(cmacHex)) {
      throw new Error('INVALID_INPUT');
    }

    const kms = KMSService.getInstance();

    // ── Layer 1: Decrypt picc_data → uid + ctr ────────────────────
    // Look up device by uid hint (from &uid= query param or SDM FileData mirror).
    // If no hint, fall back to finding any active device with an sdmEncKeyId.
    const device = await (prisma as any).device.findFirst({
      where: uidHex
        ? { uid: uidHex.toLowerCase() }
        : { sdmEncKeyId: { not: null }, isActive: true },
    });

    if (!device || !device.sdmEncKeyId || !device.sdmMacKeyId) {
      return SDMVerifierService.denied('DEVICE_NOT_FOUND');
    }

    if (!device.isActive) {
      return SDMVerifierService.denied('DEVICE_INACTIVE');
    }

    const sdmEncKeyHex = kms.unwrapUserKey(device.sdmEncKeyId);
    let uid: string;
    let ctr: number;

    try {
      const decrypted = QTagCryptoService.decryptPiccData(piccDataHex, sdmEncKeyHex);
      uid = decrypted.uid;
      ctr = decrypted.ctr;
    } catch {
      return SDMVerifierService.denied('DEVICE_NOT_FOUND');
    }

    // Verify the decrypted UID matches the device we looked up.
    // Guards against a compromised sdmEncKey validating a different device's picc_data.
    if (uid !== device.uid.toLowerCase()) {
      return SDMVerifierService.denied('DEVICE_NOT_FOUND');
    }

    // ── Layer 2: Validate CMAC ─────────────────────────────────────
    const sdmMacKeyHex = kms.unwrapUserKey(device.sdmMacKeyId);
    const expectedCmac = QTagCryptoService.computeSdmCmac(uid, ctr, sdmMacKeyHex);
    const expectedBuf = Buffer.from(expectedCmac, 'hex');
    const receivedBuf = Buffer.from(cmacHex.toLowerCase(), 'hex');

    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return SDMVerifierService.denied('MAC_INVALID');
    }

    // ── Layer 3: Monotonic counter check ──────────────────────────
    if (ctr <= device.lastCounter) {
      return SDMVerifierService.denied('REPLAY_ATTACK');
    }

    // ── Layer 4: Haversine anti-relay check ───────────────────────
    const geoCheck = QTagCryptoService.haversineCheck({
      lat,
      lon,
      lastLat: device.lastLat ?? 0,
      lastLon: device.lastLon ?? 0,
      lastTapAt: device.lastTapAt ?? new Date(0),
    });

    if (!geoCheck.ok) {
      return SDMVerifierService.denied('RELAY_ATTACK');
    }

    // ── Atomic update: Device counters + DeviceTapLog ─────────────
    const now = new Date();
    await (prisma as any).$transaction([
      (prisma as any).device.update({
        where: { id: device.id },
        data: {
          lastCounter: ctr,
          lastTapAt: now,
          lastTapIp: ip,
          lastLat: lat ?? device.lastLat,
          lastLon: lon ?? device.lastLon,
          totalTaps: { increment: 1 },
        },
      }),
      (prisma as any).deviceTapLog.create({
        data: {
          deviceId: device.id,
          counterValue: ctr,
          cmacReceived: cmacHex.toLowerCase(),
          cmacValid: true,
          verdict: 'VALID',
          ipAddress: ip,
          timestamp: now,
        },
      }),
    ]);

    // ── Load Asset (linked via Device.id) ─────────────────────────
    const asset = await (prisma as any).asset.findFirst({
      where: { deviceId: device.id },
      include: {
        eventLog: {
          where: { dltTxId: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const publicMetadata: Record<string, unknown> = {};
    if (asset && Array.isArray(asset.publicDataKeys)) {
      for (const key of asset.publicDataKeys) {
        if (asset.metadata && key in asset.metadata) {
          publicMetadata[key] = asset.metadata[key];
        }
      }
    }

    return {
      status: 'APPROVED',
      counter: ctr,
      asset: asset
        ? {
            id: asset.id,
            publicUrl: `https://qc.io/a/${asset.id}`,
            metadata: publicMetadata,
            anchorTxId: asset.eventLog?.[0]?.dltTxId ?? undefined,
            blockHeight: asset.eventLog?.[0]?.blockHeight ?? undefined,
            status: asset.status,
          }
        : undefined,
    };
  }

  private static denied(reason: DeniedReason): TapResult {
    return { status: 'DENIED', reason, message: DENY_MESSAGES[reason] };
  }
}
