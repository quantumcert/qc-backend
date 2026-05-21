// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: ERecycleFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Golden Rules:
//  - Payloads Opacos: o core NÃO valida regras de negócio
//    (ex.: peso/ tipo). Apenas armazena e ancora conforme o contrato.

//  - Criptografia: o hash do EventLog DEVE usar SHA3-512.
//  - Nomenclatura: seguir rigorosamente os nomes de campos definidos no contrato.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import prisma from '../../config/prisma';
import { AnchorQueueService } from '../AnchorQueueService';

export class ERecycleFacet {
  static async recordWaste(
    secureContext: { tenantId: string; apiKeyId?: string; role: string },

    payload: {
      containerId: string;
      wasteType: string;
      weightKg: number;
      locationMetadata: any; // Json (opaque)
      timestamp: Date;
    }
  ) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN' && role !== 'OPERATOR') {
      const err: any = new Error('Forbidden: Insufficient permissions to record waste');
      err.code = 'INSUFFICIENT_PERMISSIONS';
      throw err;
    }

    // Payload opaco: não validar weightKg nem wasteType.
    const wasteLogPayload = {
      containerId: payload.containerId,
      wasteType: payload.wasteType,
      weightKg: payload.weightKg,
      locationMetadata: payload.locationMetadata,
      timestamp: payload.timestamp,
    };

    const signatureHash = crypto
      .createHash('sha3-512')
      .update(JSON.stringify(wasteLogPayload))
      .digest('hex');

    return prisma.$transaction(async (tx: any) => {
      const wasteLog = await tx.wasteLog.create({
        data: {
          tenantId,
          containerId: payload.containerId,
          wasteType: payload.wasteType,
          weightKg: payload.weightKg,
          locationMetadata: payload.locationMetadata,
          timestamp: payload.timestamp,
        },
      });

      const eventLog = await tx.eventLog.create({
        data: {
          // EventLog exige assetId no schema atual; aqui usamos o id do wasteLog.
          assetId: wasteLog.id,
          tenantId,
          origin: apiKeyId || 'API_KEY',
          issuerId: apiKeyId || null,
          status: 'APPROVED',
          payload: {
            selector: 'erecycle.recordWaste',
            wasteLogId: wasteLog.id,
            wasteLog: wasteLogPayload,
          },
          signatureHash,
        },
      });

      await tx.wasteLog.update({
        where: { id: wasteLog.id },
        data: { eventLogId: eventLog.id },
      });

      AnchorQueueService.processQueue().catch(() => undefined);

      return { wasteLogId: wasteLog.id, eventLogId: eventLog.id };
    });
  }

  static async issueCredit(
    secureContext: { tenantId: string; apiKeyId?: string; role: string },
    payload: {
      wasteLogId: string;
      creditAmount: number;
      recipientOwnerId: string;
      metadata: any; // Json (opaque)
    }
  ) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN' && role !== 'OPERATOR') {
      const err: any = new Error('Forbidden: Insufficient permissions to issue credit');
      err.code = 'INSUFFICIENT_PERMISSIONS';
      throw err;
    }

    const creditPayload = {
      wasteLogId: payload.wasteLogId,
      creditAmount: payload.creditAmount,
      recipientOwnerId: payload.recipientOwnerId,
      metadata: payload.metadata,
    };

    const signatureHash = crypto
      .createHash('sha3-512')
      .update(JSON.stringify(creditPayload))
      .digest('hex');

    return prisma.$transaction(async (tx: any) => {
      const environmentalCredit = await tx.environmentalCredit.create({
        data: {
          tenantId,
          wasteLogId: payload.wasteLogId,
          creditAmount: payload.creditAmount,
          recipientOwnerId: payload.recipientOwnerId,
          metadata: payload.metadata,
          anchorStatus: 'PENDING',
        },
      });

      const eventLog = await tx.eventLog.create({
        data: {
          // EventLog exige assetId no schema atual; aqui usamos o id do environmentalCredit.
          assetId: environmentalCredit.id,
          tenantId,
          origin: apiKeyId || 'API_KEY',
          issuerId: apiKeyId || null,
          status: 'APPROVED',
          payload: {
            selector: 'erecycle.issueCredit',
            environmentalCreditId: environmentalCredit.id,
            wasteLogId: payload.wasteLogId,
            credit: creditPayload,
          },
          signatureHash,
        },
      });

      AnchorQueueService.processQueue().catch(() => undefined);

      return { environmentalCreditId: environmentalCredit.id, eventLogId: eventLog.id };
    });
  }
}

