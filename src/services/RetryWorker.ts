// src/services/RetryWorker.ts
// Multi-Chain Retry Worker with Exponential Backoff and DLQ
// Processes PendingTransaction records across all supported chains.

import prisma from '../config/prisma';
import { DLTAdapterFactory, SupportedChain } from './DLTAdapterFactory';
import { WebhookDispatcher } from '../utils/WebhookDispatcher';

export class RetryWorker {
  /**
   * Base delay in milliseconds for exponential backoff.
   * Retry schedule: 1min, 2min, 4min, 8min, 16min (for maxAttempts=5)
   */
  static readonly BASE_DELAY_MS = 60000;

  /**
   * Maximum delay cap (60 minutes).
   */
  static readonly MAX_DELAY_MS = 3600000;

  /**
   * Errors that are considered CRITICAL and should go straight to DLQ
   * without retrying (invalid signature, insufficient funds, etc.).
   */
  static readonly CRITICAL_ERROR_PATTERNS = [
    'invalid signature',
    'insufficient funds',
    'insufficient balance',
    'unauthorized',
    'not authorized',
    'invalid triple proof',
    'sender does not match',
    'invalid address',
    'invalid amount',
    'escrow not found',
    'already released',
    'already cancelled',
  ];

  /**
   * Processes all retryable pending transactions.
   * Called by SchedulerService on a cron interval.
   */
  static async processRetries(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    dlq: number;
  }> {
    const now = new Date();

    // Fetch transactions ready for retry (PENDING or FAILED with nextRetryAt <= now)
    const pendingTxs = await prisma.pendingTransaction.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        isDlq: false,
        OR: [
          { nextRetryAt: { lte: now } },
          { nextRetryAt: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 20, // Process in batches to avoid overwhelming the node
    });

    if (pendingTxs.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0, dlq: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    let dlq = 0;

    for (const tx of pendingTxs) {
      try {
        // Atomic lock: mark as PROCESSING
        const locked = await prisma.pendingTransaction.updateMany({
          where: {
            id: tx.id,
            status: { in: ['PENDING', 'FAILED'] },
          },
          data: { status: 'PROCESSING' },
        });

        if (locked.count === 0) {
          continue; // Another worker picked it up
        }

        const result = await RetryWorker.executeTransaction(tx);

        if (result.success) {
          await prisma.pendingTransaction.update({
            where: { id: tx.id },
            data: {
              status: 'SUCCESS',
              chainTxId: result.txId,
              confirmedAt: new Date(),
              attemptCount: tx.attemptCount + 1,
            },
          });

          await WebhookDispatcher.dispatch(tx.tenantId, 'RETRY_SUCCESS', {
            txRef: tx.txRef,
            txType: tx.txType,
            chain: tx.chain,
            chainTxId: result.txId,
          });

          succeeded++;
        } else {
          const errMsg = result.error || 'Unknown error';
          const isCritical = RetryWorker.isCriticalError(errMsg);
          await RetryWorker.handleFailure(tx, errMsg, isCritical);

          if (isCritical || tx.attemptCount + 1 >= tx.maxAttempts) {
            dlq++;
          } else {
            failed++;
          }
        }
      } catch (error: any) {
        console.error(`[RetryWorker] Unexpected error processing tx ${tx.id}:`, error);
        await RetryWorker.handleFailure(tx, error.message || 'Unknown error');
        failed++;
      }
    }

    return {
      processed: pendingTxs.length,
      succeeded,
      failed,
      dlq,
    };
  }

  /**
   * Executes a single pending transaction on the appropriate chain.
   */
  private static async executeTransaction(tx: {
    chain: string;
    txType: string;
    payload: any;
    txRef: string;
  }): Promise<{ success: boolean; txId?: string; error?: string }> {
    const adapter = DLTAdapterFactory.getAdapter(tx.chain as SupportedChain);

    try {
      let txId: string;

      switch (tx.txType) {
        case 'ANCHOR': {
          const { eventId, hash, options } = tx.payload;
          txId = await adapter.anchorEvent(eventId, hash, options);
          break;
        }
        case 'ESCROW_CREATE': {
          const params = tx.payload;
          txId = await adapter.createEscrow(params);
          break;
        }
        case 'ESCROW_RELEASE': {
          const { escrowId, txRef } = tx.payload;
          txId = await adapter.releaseEscrow(escrowId, txRef);
          break;
        }
        case 'ESCROW_CANCEL': {
          const { escrowId, txRef } = tx.payload;
          txId = await adapter.cancelEscrow(escrowId, txRef);
          break;
        }
        case 'TRANSFER': {
          const params = tx.payload;
          txId = await adapter.sendAsset(params);
          break;
        }
        default:
          return { success: false, error: `Unknown txType: ${tx.txType}` };
      }

      return { success: true, txId };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Determines if an error is critical and should bypass retries.
   */
  private static isCriticalError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return RetryWorker.CRITICAL_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
  }

  /**
   * Handles a failed transaction: updates retry count, schedules next attempt,
   * or moves to DLQ if max attempts reached or error is critical.
   */
  private static async handleFailure(
    tx: {
      id: string;
      tenantId: string;
      attemptCount: number;
      maxAttempts: number;
      txRef: string;
      txType: string;
      chain: string;
    },
    errorMessage: string,
    isCritical: boolean = false
  ): Promise<void> {
    const newAttemptCount = tx.attemptCount + 1;
    const isFinalAttempt = newAttemptCount >= tx.maxAttempts;

    if (isCritical || isFinalAttempt) {
      // Move to DLQ immediately (critical) or after max attempts
      await prisma.pendingTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'DLQ',
          isDlq: true,
          dlqReason: errorMessage,
          dlqAt: new Date(),
          attemptCount: newAttemptCount,
          lastError: errorMessage,
        },
      });

      await WebhookDispatcher.dispatch(tx.tenantId, 'RETRY_DLQ', {
        txRef: tx.txRef,
        txType: tx.txType,
        chain: tx.chain,
        attempts: newAttemptCount,
        error: errorMessage,
      });

      console.error(
        `[RetryWorker] TX ${tx.id} moved to DLQ.${isCritical ? ' (critical error)' : ` After ${newAttemptCount} attempts.`} Error: ${errorMessage}`
      );
    } else {
      // Schedule next retry with exponential backoff
      const delayMs = Math.min(
        RetryWorker.BASE_DELAY_MS * Math.pow(2, newAttemptCount - 1),
        RetryWorker.MAX_DELAY_MS
      );
      const nextRetryAt = new Date(Date.now() + delayMs);

      await prisma.pendingTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'FAILED',
          attemptCount: newAttemptCount,
          lastError: errorMessage,
          nextRetryAt,
        },
      });

      console.log(
        `[RetryWorker] TX ${tx.id} failed (attempt ${newAttemptCount}/${tx.maxAttempts}). Next retry at ${nextRetryAt.toISOString()}`
      );
    }
  }

  /**
   * Inserts a new transaction into the pending queue.
   * Called by AnchorQueueService or other services when a DLT operation fails.
   */
  static async enqueue(params: {
    tenantId: string;
    txRef: string;
    txType: string;
    chain: string;
    payload: Record<string, unknown>;
    error?: string;
  }): Promise<void> {
    await prisma.pendingTransaction.create({
      data: {
        tenantId: params.tenantId,
        txRef: params.txRef,
        txType: params.txType as any,
        chain: params.chain,
        payload: params.payload,
        status: 'PENDING',
        attemptCount: 0,
        lastError: params.error,
      },
    });

    console.log(`[RetryWorker] Enqueued ${params.txType} tx ${params.txRef} for chain ${params.chain}`);
  }
}

