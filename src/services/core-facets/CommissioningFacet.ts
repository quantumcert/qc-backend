import crypto from 'node:crypto';
import prisma from '../../config/prisma';
import { QTagFulfillmentStatus } from '@prisma/client';
import { KMSService } from '../KMSService';
import { QuantumSignerService } from '../QuantumSignerService';
import { QTagCryptoService } from '../QTagCryptoService';
import { QTagFulfillmentFacet } from './QTagFulfillmentFacet';

interface SecureContext {
  tenantId: string;
  apiKeyId: string;
  role: 'ADMIN' | 'OPERATOR' | 'READER';
}

interface StartPayload {
  assetId: string;
  ntagUID: string;
  metadata: Record<string, unknown>;
  fulfillmentOrderId?: string;
  stationId?: string;
  operatorId?: string;
}

interface ConfirmPayload {
  sessionId: string;
  success: boolean;
  bytesWritten: number;
  ntagUID: string;
}

interface StatusPayload {
  sessionId: string;
}

export class CommissioningFacet {
  /**
   * Executes backend commissioning steps 1-6.
   * Returns layout, pages, sdmMacKey (plaintext, one-time exposure), writeKey.
   * sdmMacKey is never stored in plaintext — only the KMS-wrapped form persists.
   */
  static async start(ctx: SecureContext, payload: StartPayload) {
    const { assetId, ntagUID, metadata } = payload;

    if (!/^[0-9A-Fa-f]{14}$/.test(ntagUID)) {
      throw new Error('Invalid ntagUID: must be 14 hex characters (7 bytes)');
    }

    const uid = ntagUID.toLowerCase();
    let fulfillmentOrder: any = null;
    if (payload.fulfillmentOrderId) {
      fulfillmentOrder = await (prisma as any).qTagFulfillmentOrder.findUnique({
        where: { id: payload.fulfillmentOrderId },
      });

      if (
        !fulfillmentOrder
        || fulfillmentOrder.tenantId !== ctx.tenantId
        || fulfillmentOrder.assetId !== assetId
      ) {
        throw new Error('Fulfillment order not found for asset');
      }

      const allowedStatuses = [
        QTagFulfillmentStatus.REQUESTED,
        QTagFulfillmentStatus.READY_FOR_ENCODING,
        QTagFulfillmentStatus.ENCODING_FAILED,
      ];
      if (!allowedStatuses.includes(fulfillmentOrder.status)) {
        throw new Error('Fulfillment order is not ready for encoding');
      }
    }

    const kms = KMSService.getInstance();
    const signer = QuantumSignerService.getInstance();
    const metadataJson = JSON.stringify(metadata);
    const tenantSecretHex = await kms.getTenantSecretHex(ctx.tenantId, 'qtag-commissioning');

    // Step 1-2: Falcon-512 sign metadata
    const hybrid = await signer.signPayload(
      { assetId, ntagUID: uid, metadata, timestamp: Date.now() },
      assetId,
      'ASSET',
      tenantSecretHex
    );
    const falconHashFull = crypto
      .createHash('sha3-512')
      .update(Buffer.from(hybrid.pqcProof.signature, 'base64'))
      .digest();
    const falconHashHex = falconHashFull.toString('hex');
    const truncatedFalconHash = falconHashFull.slice(0, 32).toString('hex');

    // Step 3: Derive DAT
    const truncatedDAT = QTagCryptoService.deriveDAT(falconHashHex, uid);

    // Step 4: Enqueue anchor via EventLog (AnchorQueueService picks up dltTxId: null)
    await (prisma as any).eventLog.create({
      data: {
        tenantId: ctx.tenantId,
        assetId,
        origin: 'COMMISSIONING',
        payload: { falconHash: truncatedFalconHash, ntagUID: uid, dat: truncatedDAT },
        signatureHash: hybrid.payloadHash,
        dltTxId: null,
        status: 'PENDING',
      },
    });

    // Step 5: Generate SDM keys — plaintext never persisted
    const sdmMacKeyPlain = crypto.randomBytes(16).toString('hex');
    const sdmEncKeyPlain = crypto.randomBytes(16).toString('hex');
    // writeKey is ephemeral by design: used once by the encoding station for APDU authentication,
    // never stored on backend. If write fails, client calls commissioning.start again for a new session.
    const writeKeyPlain = crypto.randomBytes(16).toString('hex');
    const sdmMacKeyId = kms.wrapUserKey(sdmMacKeyPlain);
    const sdmEncKeyId = kms.wrapUserKey(sdmEncKeyPlain);

    // Step 6: Build 144-byte layout
    const layout = QTagCryptoService.buildNtagLayout({
      ntagUID: uid,
      truncatedDAT,
      truncatedFalconHash,
      metadataJson,
    });
    const layoutB64 = layout.toString('base64');
    const pages = QTagCryptoService.layoutToPages(layout);

    const session = await (prisma as any).encodingSession.create({
      data: {
        tenantId: ctx.tenantId,
        assetId,
        fulfillmentOrderId: payload.fulfillmentOrderId,
        ntagUID: uid,
        status: 'IN_PROGRESS',
        attemptNo: fulfillmentOrder ? (fulfillmentOrder.attempts || 0) + 1 : 1,
        stationId: payload.stationId,
        operatorId: payload.operatorId || ctx.apiKeyId,
        layoutB64,
        sdmMacKeyId,
        sdmEncKeyId,
      },
    });

    if (fulfillmentOrder) {
      await (prisma as any).qTagFulfillmentOrder.update({
        where: { id: fulfillmentOrder.id },
        data: {
          status: QTagFulfillmentStatus.ENCODING_IN_PROGRESS,
          attempts: { increment: 1 },
          claimedByActorId: payload.operatorId || ctx.apiKeyId,
          lastError: null,
        },
      });
    }

    return {
      sessionId: session.id,
      layout: layoutB64,
      pages,
      sdmMacKey: sdmMacKeyPlain,
      writeKey: writeKeyPlain,
      lockAfterWrite: process.env.NODE_ENV === 'production',
    };
  }

  /**
   * Confirms physical write completion. Marks session COMPLETED and upserts Device.
   */
  static async confirm(ctx: SecureContext, payload: ConfirmPayload) {
    const { sessionId, success, ntagUID, bytesWritten } = payload;

    const session = await (prisma as any).encodingSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.tenantId !== ctx.tenantId) {
      throw new Error('Session not found');
    }

    if (session.ntagUID && session.ntagUID !== ntagUID.toLowerCase()) {
      throw new Error('ntagUID does not match session');
    }

    if (success && bytesWritten < 144) {
      throw new Error('Incomplete QTAG write');
    }

    const newStatus = success ? 'COMPLETED' : 'FAILED';

    const updated = await (prisma as any).encodingSession.update({
      where: { id: sessionId },
      data: {
        status: newStatus,
        ...(success ? { lockedAt: new Date() } : {}),
      },
    });

    if (success) {
      const device = await (prisma as any).device.upsert({
        where: { uid: ntagUID.toLowerCase() },
        create: {
          uid: ntagUID.toLowerCase(),
          tenantId: ctx.tenantId,
          sdmMacKeyId: session.sdmMacKeyId,
          sdmEncKeyId: session.sdmEncKeyId,
        },
        update: {
          sdmMacKeyId: session.sdmMacKeyId,
          sdmEncKeyId: session.sdmEncKeyId,
          isActive: true,
        },
      });

      if (session.fulfillmentOrderId) {
        const order = await (prisma as any).qTagFulfillmentOrder.findUnique({
          where: { id: session.fulfillmentOrderId },
        });

        if (
          !order
          || order.tenantId !== ctx.tenantId
          || order.assetId !== session.assetId
        ) {
          throw new Error('Fulfillment order not found for session');
        }

        await (prisma as any).asset.update({
          where: { id: session.assetId },
          data: { deviceId: device.id },
        });

        await QTagFulfillmentFacet.consumeReservation(prisma as any, {
          tenantId: ctx.tenantId,
          fulfillmentOrderId: session.fulfillmentOrderId,
          assetId: session.assetId,
          userId: order.userId,
          reason: 'QTAG ativada após gravação física confirmada.',
        });

        await (prisma as any).qTagFulfillmentOrder.update({
          where: { id: session.fulfillmentOrderId },
          data: {
            status: QTagFulfillmentStatus.ACTIVATED,
            activatedAt: new Date(),
            lastError: null,
          },
        });
      }
    } else if (session.fulfillmentOrderId) {
      await (prisma as any).qTagFulfillmentOrder.update({
        where: { id: session.fulfillmentOrderId },
        data: {
          status: QTagFulfillmentStatus.ENCODING_FAILED,
          lastError: 'Encoding station reported failure',
        },
      });
    }

    return { status: updated.status, sessionId };
  }

  /**
   * Returns current status of an encoding session.
   */
  static async statusQuery(ctx: SecureContext, payload: StatusPayload) {
    const session = await (prisma as any).encodingSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session || session.tenantId !== ctx.tenantId) {
      throw new Error('Session not found');
    }

    return {
      sessionId: session.id,
      status: session.status,
      ntagUID: session.ntagUID,
      assetId: session.assetId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
