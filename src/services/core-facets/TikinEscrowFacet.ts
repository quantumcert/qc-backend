// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: TikinEscrowFacet
// Golden Rules:
//  - Core does NOT validate business rules beyond tenant scoping + role checks.
//  - Payloads are treated as opaque; business interpretation happens off-chain.
//  - Naming must follow selector contract.
//  - Use universal terms inside core facet logic.
// ═══════════════════════════════════════════════════════════

import prisma from '../../config/prisma';
import { DLTAdapterFactory, SupportedChain } from '../DLTAdapterFactory';
import type { DLTTransitionPayload } from '../../interfaces/IDLTAdapter';

type SecureContext = { tenantId: string; apiKeyId: string; role: string };

type LockPayload = {
  assetId: string;
  escrowId?: string; // contract key used by Diamond tests
  escrowRecordId?: string; // contract key used by unit tests

  chain: SupportedChain;
  sender: string;
  receiver: string;
  amount: string;
  unlockTimestamp: number; // unix seconds
  releaseMode: 'AUTO' | 'MANUAL';
  assetAddress?: string;
  pqcProof?: string;
  tripleSign?: any;
};

type ReleasePayload = {
  escrowId: string; // contract key used by Diamond tests
  assetId: string;
};

type CancelPayload = {
  escrowId: string; // contract key used by Diamond tests
  assetId: string;
};

function makeError(message: string, code: string, httpStatus: number): Error {
  const err: any = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  return err;
}

function normalizeTimestamp(value: any): number {
  if (!value) return 0;
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  if (typeof value === 'number') {
    // if ms => convert to seconds
    return value > 9999999999 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
}

async function executeAdapterTransition(adapter: any, transitionPayload: DLTTransitionPayload): Promise<string> {
  return typeof adapter?.executeGenericTransition === 'function'
    ? adapter.executeGenericTransition(transitionPayload)
    : (async () => {
        switch (transitionPayload.operation) {
          case 'LOCK':
            return adapter.createEscrow({
              sender: transitionPayload.sender,
              receiver: transitionPayload.receiver,
              amount: transitionPayload.amount,
              assetAddress: transitionPayload.assetAddress,
              unlockTimestamp: transitionPayload.unlockTimestamp ?? 0,
              pqcProof: transitionPayload.pqcProof,
              tripleSign: transitionPayload.tripleSign,
              // legacy correlation key for older mocks
              escrowId: transitionPayload.transitionId,
            });
          case 'RELEASE':
            return adapter.releaseEscrow(transitionPayload.transitionId, transitionPayload.transitionId);
          case 'CANCEL':
            return adapter.cancelEscrow(transitionPayload.transitionId, transitionPayload.transitionId);
          default:
            throw new Error(`Unsupported operation ${(transitionPayload as any).operation}`);
        }
      })();
}

function escrowModel() {
  // Suporta ambos contratos: unit tests usam `escrowRecord`, Diamond E2E usa `escrow`.
  return (prisma as any).escrowRecord ?? (prisma as any).escrow;
}

function getEscrowReleaseMode(escrow: any): string | undefined {
  return escrow?.releaseMode ?? escrow?.releaseMode;
}

export class TikinEscrowFacet {
  static async lock(secureContext: SecureContext, payload: LockPayload) {

    const { tenantId, apiKeyId, role } = secureContext;

    const escrowId = payload.escrowId ?? payload.escrowRecordId;

    if (!escrowId) {
      throw new Error('Missing escrow identifier (escrowId or escrowRecordId)');
    }


    if (role !== 'ADMIN' && role !== 'OPERATOR') {

      throw makeError('Forbidden: insufficient permissions to lock', 'INSUFFICIENT_PERMISSIONS', 403);
    }

    const asset = await prisma.asset.findUnique({
      where: { id: payload.assetId, tenantId },
    });

    if (!asset) {
      throw makeError('Asset not found or access denied', 'ASSET_NOT_FOUND', 404);
    }

    if (asset.status !== 'ACTIVE') {
      throw makeError(`Asset cannot be locked from state: ${asset.status}`, 'INVALID_ASSET_STATE', 422);
    }

    const adapter = DLTAdapterFactory.getAdapter(payload.chain);

    const transitionPayload: DLTTransitionPayload = {
      transitionId: payload.escrowId,
      sender: payload.sender,
      receiver: payload.receiver,
      amount: payload.amount,
      assetAddress: payload.assetAddress,
      unlockTimestamp: normalizeTimestamp(payload.unlockTimestamp),
      operation: 'LOCK',
      pqcProof: payload.pqcProof,
      tripleSign: payload.tripleSign,
    };

    const lockTxId = await executeAdapterTransition(adapter, transitionPayload);

    const model = escrowModel();

    // IMPORTANT: suporte a 2 contratos: unit tests usam `escrowRecord`, E2E usa `escrow`.
    await model.create({
      data: {
        id: crypto.randomUUID(),
        escrowId: payload.escrowId,
        assetId: payload.assetId,
        tenantId,
        chain: payload.chain,
        chainTxId: lockTxId,
        sender: payload.sender,
        receiver: payload.receiver,
        amount: payload.amount,
        assetAddress: payload.assetAddress ?? null,
        unlockTimestamp: new Date(normalizeTimestamp(payload.unlockTimestamp) * 1000),
        status: 'ACTIVE',
        releaseMode: payload.releaseMode,
        metadata: {},
      } as any,
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
        issuerId: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_LOCKED',
          escrowId: payload.escrowId,
          chain: payload.chain,
          unlockTimestamp: payload.unlockTimestamp,
          releaseMode: payload.releaseMode,
          chainTxId: lockTxId,
        },
      },
    });

    return {
      escrowId: escrowId,
      // compat: unit tests usam `escrowRecordId`
      escrowRecordId: payload.escrowRecordId ?? escrowId,
      assetId: payload.assetId,

      status: 'ACTIVE',
      txId: lockTxId,
    };
  }

  static async release(secureContext: SecureContext, payload: ReleasePayload) {
    const { tenantId, apiKeyId, role } = secureContext;


    if (role !== 'ADMIN' && role !== 'OPERATOR') {
      throw makeError('Forbidden: insufficient permissions to release', 'INSUFFICIENT_PERMISSIONS', 403);
    }

    const escrow = await escrowModel().findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow record not found', 'ESCROW_NOT_FOUND', 404);
    }

    if (escrow.status === 'RELEASED' || escrow.status === 'CANCELLED') {
      throw makeError('Escrow is already closed', 'ESCROW_ALREADY_CLOSED', 409);
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const unlockTs = normalizeTimestamp(escrow.unlockTimestamp);

    // Compat: em modo MANUAL o core não deve bloquear por timelock.
    if (escrow.releaseMode !== 'MANUAL' && nowTs < unlockTs) {
      throw makeError('unlockTimestamp not reached', 'UNLOCK_NOT_REACHED', 422);
    }


    const adapter = DLTAdapterFactory.getAdapter(escrow.chain as SupportedChain);

    const transitionPayload: DLTTransitionPayload = {
      transitionId: payload.escrowId,
      sender: escrow.sender,
      receiver: escrow.receiver,
      amount: escrow.amount,
      assetAddress: escrow.assetAddress ?? undefined,
      unlockTimestamp: unlockTs,
      operation: 'RELEASE',
      pqcProof: undefined,
      tripleSign: undefined,
    };

    const releaseTxId = await executeAdapterTransition(adapter, transitionPayload);

    await escrowModel().update({
      where: { id: escrow.id },
      data: {
        status: 'RELEASED',
        chainTxId: releaseTxId,
        releaseConfirmedAt: new Date(),
      } as any,
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
        issuerId: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_RELEASED',
          escrowId: payload.escrowId,
          releasedBy: apiKeyId,
          releaseMode: escrow.releaseMode,
          chainTxId: releaseTxId,
        },
      },
    });

    return {
      escrowId: escrow.escrowId,
      assetId: payload.assetId,
      status: 'RELEASED',
      txId: releaseTxId,
    };
  }

  static async cancel(secureContext: SecureContext, payload: CancelPayload) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN') {
      throw makeError('Only ADMIN can cancel', 'INSUFFICIENT_PERMISSIONS', 403);
    }

    const escrow = await escrowModel().findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow record not found', 'ESCROW_NOT_FOUND', 404);
    }

    if (escrow.status === 'RELEASED' || escrow.status === 'CANCELLED') {
      throw makeError('Escrow is already closed', 'ESCROW_ALREADY_CLOSED', 409);
    }

    const adapter = DLTAdapterFactory.getAdapter(escrow.chain as SupportedChain);

    const transitionPayload: DLTTransitionPayload = {
      transitionId: payload.escrowId,
      sender: escrow.sender,
      receiver: escrow.receiver,
      amount: escrow.amount,
      assetAddress: escrow.assetAddress ?? undefined,
      // keep defensive normalization even if not required for cancel
      unlockTimestamp: normalizeTimestamp(escrow.unlockTimestamp),
      operation: 'CANCEL',
      pqcProof: undefined,
      tripleSign: undefined,
    };

    const cancelTxId = await executeAdapterTransition(adapter, transitionPayload);

    await escrowModel().update({
      where: { id: escrow.id },
      data: {
        status: 'CANCELLED',
        chainTxId: cancelTxId,
      } as any,
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
        issuerId: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_CANCELLED',
          escrowId: payload.escrowId,
          cancelledBy: apiKeyId,
          chainTxId: cancelTxId,
        },
      },
    });

    return {
      escrowId: escrow.escrowId,
      assetId: payload.assetId,
      status: 'CANCELLED',
      txId: cancelTxId,
    };
  }
}

