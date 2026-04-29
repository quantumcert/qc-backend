// src/services/core-facets/EscrowFacet.ts
import prisma from '../../config/prisma';
import { DLTAdapterFactory, SupportedChain } from '../DLTAdapterFactory';
import { TripleSignPayload } from '../multi-chain/types';

interface SecureContext {
  tenantId: string;
  apiKeyId: string;
  role: string;
}

interface LockPayload {
  assetId: string;
  escrowId: string;
  chain: SupportedChain;
  sender: string;
  receiver: string;
  amount: string;
  unlockTimestamp: number;
  releaseMode: 'AUTO' | 'MANUAL';
  assetAddress?: string;
  pqcProof?: string;
  tripleSign?: TripleSignPayload;
}

interface ReleasePayload {
  escrowId: string;
  assetId: string;
}

interface CancelPayload {
  escrowId: string;
  assetId: string;
}

interface StatusPayload {
  escrowId: string;
}

function makeError(message: string, code: string, httpStatus: number): Error {
  const err: any = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  return err;
}

export const ESCROW_WORKER_API_KEY_ID = 'ESCROW_WORKER';

export class EscrowFacet {
  static async lock(secureContext: SecureContext, payload: LockPayload) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN' && role !== 'OPERATOR') {
      throw makeError('Insufficient role to lock escrow', 'INSUFFICIENT_ROLE', 403);
    }

    if (payload.unlockTimestamp <= Math.floor(Date.now() / 1000)) {
      throw makeError('unlockTimestamp must be in the future', 'INVALID_UNLOCK_TIMESTAMP', 422);
    }

    const asset = await prisma.asset.findUnique({
      where: { id: payload.assetId, tenantId },
    });

    if (!asset) {
      throw makeError('Asset not found or access denied', 'ASSET_NOT_FOUND', 404);
    }

    if (asset.status !== 'ACTIVE') {
      throw makeError(
        `Asset cannot be locked from state: ${asset.status}`,
        'INVALID_ASSET_STATE',
        422
      );
    }

    const escrow = await prisma.escrow.create({
      data: {
        escrowId: payload.escrowId,
        tenantId,
        assetId: payload.assetId,
        chain: payload.chain,
        sender: payload.sender,
        receiver: payload.receiver,
        amount: payload.amount,
        assetAddress: payload.assetAddress ?? null,
        unlockTimestamp: new Date(payload.unlockTimestamp * 1000),
        releaseMode: payload.releaseMode,
        status: 'ACTIVE',
      },
    });

    const adapter = DLTAdapterFactory.getAdapter(payload.chain);
    const chainTxId = await adapter.createEscrow({
      escrowId: payload.escrowId,
      sender: payload.sender,
      receiver: payload.receiver,
      amount: payload.amount,
      assetAddress: payload.assetAddress,
      unlockTimestamp: payload.unlockTimestamp,
      pqcProof: payload.pqcProof,
      tripleSign: payload.tripleSign,
    });

    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { chainTxId },
    });

    await prisma.asset.update({
      where: { id: payload.assetId },
      data: { status: 'LOCKED_IN_ESCROW' as any },
    });

    await prisma.eventLog.create({
      data: {
        assetId: payload.assetId,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_LOCKED',
          escrowId: payload.escrowId,
          chain: payload.chain,
          unlockTimestamp: payload.unlockTimestamp,
          releaseMode: payload.releaseMode,
        },
      },
    });

    return { escrowId: payload.escrowId, assetId: payload.assetId, status: 'ACTIVE', chainTxId };
  }

  static async release(secureContext: SecureContext, payload: ReleasePayload) {
    const { tenantId, apiKeyId, role } = secureContext;
    const isWorker = apiKeyId === ESCROW_WORKER_API_KEY_ID;

    if (!isWorker && role !== 'ADMIN' && role !== 'OPERATOR') {
      throw makeError('Insufficient role to release escrow', 'INSUFFICIENT_ROLE', 403);
    }

    const escrow = await prisma.escrow.findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow not found', 'ESCROW_NOT_FOUND', 404);
    }

    if (escrow.status === 'RELEASED' || escrow.status === 'CANCELLED') {
      throw makeError('Escrow is already closed', 'ESCROW_ALREADY_CLOSED', 409);
    }

    if (!isWorker && escrow.releaseMode === 'AUTO') {
      throw makeError(
        'This escrow uses AUTO release mode. Use the EscrowReleaseWorker.',
        'RELEASE_MODE_MISMATCH',
        422
      );
    }

    const adapter = DLTAdapterFactory.getAdapter(escrow.chain as SupportedChain);
    const chainTxId = await adapter.releaseEscrow(escrow.escrowId, escrow.id);

    const updateData: any = { status: 'RELEASED', chainTxId };
    if (!isWorker) {
      updateData.releaseConfirmedAt = new Date();
    }

    await prisma.escrow.update({
      where: { id: escrow.id },
      data: updateData,
    });

    await prisma.asset.update({
      where: { id: payload.assetId },
      data: { status: 'ACTIVE' as any },
    });

    await prisma.eventLog.create({
      data: {
        assetId: payload.assetId,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_RELEASED',
          escrowId: escrow.escrowId,
          releaseMode: escrow.releaseMode,
          releasedBy: isWorker ? 'ESCROW_WORKER' : apiKeyId,
        },
      },
    });

    return { escrowId: escrow.escrowId, assetId: payload.assetId, status: 'RELEASED', chainTxId };
  }

  static async cancel(secureContext: SecureContext, payload: CancelPayload) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN') {
      throw makeError('Only ADMIN can cancel an escrow', 'INSUFFICIENT_ROLE', 403);
    }

    const escrow = await prisma.escrow.findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow not found', 'ESCROW_NOT_FOUND', 404);
    }

    if (escrow.status === 'RELEASED' || escrow.status === 'CANCELLED') {
      throw makeError('Escrow is already closed', 'ESCROW_ALREADY_CLOSED', 409);
    }

    const adapter = DLTAdapterFactory.getAdapter(escrow.chain as SupportedChain);
    const chainTxId = await adapter.cancelEscrow(escrow.escrowId, escrow.id);

    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { status: 'CANCELLED', chainTxId },
    });

    await prisma.asset.update({
      where: { id: payload.assetId },
      data: { status: 'ACTIVE' as any },
    });

    await prisma.eventLog.create({
      data: {
        assetId: payload.assetId,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_CANCELLED',
          escrowId: escrow.escrowId,
          cancelledBy: apiKeyId,
        },
      },
    });

    return { escrowId: escrow.escrowId, assetId: payload.assetId, status: 'CANCELLED', chainTxId };
  }

  static async getStatus(secureContext: SecureContext, payload: StatusPayload) {
    const { tenantId } = secureContext;

    const escrow = await prisma.escrow.findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow not found', 'ESCROW_NOT_FOUND', 404);
    }

    return {
      escrowId: escrow.escrowId,
      assetId: escrow.assetId,
      status: escrow.status,
      chain: escrow.chain,
      releaseMode: escrow.releaseMode,
      unlockTimestamp: escrow.unlockTimestamp,
      chainTxId: escrow.chainTxId,
      createdAt: escrow.createdAt,
      releaseConfirmedAt: (escrow as any).releaseConfirmedAt ?? null,
    };
  }
}
