// src/services/EscrowReleaseWorker.ts
import prisma from '../config/prisma';
import { EscrowFacet, ESCROW_WORKER_API_KEY_ID } from './core-facets/EscrowFacet';

const BATCH_SIZE = 10;

export class EscrowReleaseWorker {
  static async processReleases(): Promise<{ released: number; failed: number }> {
    const now = new Date();

    const expiredEscrows = await prisma.escrow.findMany({
      where: {
        status: 'ACTIVE',
        releaseMode: 'AUTO',
        unlockTimestamp: { lte: now },
      },
      orderBy: { unlockTimestamp: 'asc' },
      take: BATCH_SIZE,
    });

    if (expiredEscrows.length === 0) {
      return { released: 0, failed: 0 };
    }

    let released = 0;
    let failed = 0;

    for (const escrow of expiredEscrows) {
      // Atomic lock: mark as PROCESSING to prevent double-release
      await prisma.escrow.update({
        where: { id: escrow.id },
        data: { status: 'PROCESSING' as any },
      });

      try {
        const workerCtx = {
          tenantId: escrow.tenantId,
          apiKeyId: ESCROW_WORKER_API_KEY_ID,
          role: 'ADMIN',
        };

        await EscrowFacet.release(workerCtx, {
          escrowId: escrow.escrowId,
          assetId: escrow.assetId ?? '',
        });

        released++;
      } catch (err) {
        console.error(`[EscrowReleaseWorker] Failed to release escrow ${escrow.escrowId}:`, err);

        // Revert to ACTIVE so it can be retried next cycle
        await prisma.escrow.update({
          where: { id: escrow.id },
          data: { status: 'ACTIVE' as any },
        });

        failed++;
      }
    }

    return { released, failed };
  }
}
