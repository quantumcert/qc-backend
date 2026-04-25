// ============================================================
// SECURITY WATCHDOG SERVICE
// Anomaly Detection & Panic Button for Blockchain Observer
//
// PILLAR 3: Monitors deposit patterns, detects anomalies,
// and triggers circuit breaker when thresholds are exceeded.
//
// PLACEHOLDER: Sinarca integration (deforestation anomaly)
//   - When Sinarca detects irregular forest activity,
//     this service can trigger a panic halt.
//
// THRESHOLDS (configurable via env):
//   - MAX_DEPOSITS_PER_MINUTE: default 100
//   - MAX_DEPOSIT_VOLUME_PER_MINUTE: default 1,000,000 USD
//   - MAX_FAILED_DEPOSIT_RATIO: default 0.5 (50%)
// ============================================================

import prisma from '../config/prisma';
import { CircuitBreakerService } from './CircuitBreakerService';

export interface WatchdogThresholds {
  maxDepositsPerMinute: number;
  maxDepositVolumePerMinute: string; // in wei/smallest unit
  maxFailedDepositRatio: number; // 0.0 - 1.0
  maxPendingDepositAgeMinutes: number;
}

export interface AnomalyReport {
  type: 'DEPOSIT_SPIKE' | 'VOLUME_SPIKE' | 'HIGH_FAILURE_RATE' | 'STALE_DEPOSITS' | 'SINARCA_ALERT' | 'MULTIPLE_CRITICAL';
  severity: 'WARNING' | 'CRITICAL' | 'PANIC';
  message: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export class SecurityWatchdogService {
  private static instance: SecurityWatchdogService;
  private circuitBreaker: CircuitBreakerService;
  private thresholds: WatchdogThresholds;
  private lastCheckAt: Date = new Date(0);
  private anomalyHistory: AnomalyReport[] = [];
  private readonly MAX_HISTORY_SIZE = 1000;

  private constructor() {
    this.circuitBreaker = CircuitBreakerService.getInstance();
    this.thresholds = this.loadThresholds();
  }

  static getInstance(): SecurityWatchdogService {
    if (!SecurityWatchdogService.instance) {
      SecurityWatchdogService.instance = new SecurityWatchdogService();
    }
    return SecurityWatchdogService.instance;
  }

  private loadThresholds(): WatchdogThresholds {
    return {
      maxDepositsPerMinute: parseInt(process.env.WATCHDOG_MAX_DEPOSITS_PER_MINUTE || '100', 10),
      maxDepositVolumePerMinute: process.env.WATCHDOG_MAX_VOLUME_PER_MINUTE || '1000000000000', // ~1M USDC (6 decimals)
      maxFailedDepositRatio: parseFloat(process.env.WATCHDOG_MAX_FAILURE_RATIO || '0.5'),
      maxPendingDepositAgeMinutes: parseInt(process.env.WATCHDOG_MAX_PENDING_AGE_MINUTES || '60', 10),
    };
  }

  /**
   * Main anomaly detection loop. Called by SchedulerService cron job.
   * Checks all metrics and triggers circuit breaker if needed.
   */
  async checkAnomalies(): Promise<AnomalyReport[]> {
    const anomalies: AnomalyReport[] = [];
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60_000);

    try {
      // --- Check 1: Deposit Spike ---
      const recentDeposits = await (prisma as any).deposit.findMany({
        where: {
          detectedAt: { gte: oneMinuteAgo },
        },
      });

      if (recentDeposits.length > this.thresholds.maxDepositsPerMinute) {
        anomalies.push({
          type: 'DEPOSIT_SPIKE',
          severity: 'CRITICAL',
          message: `Deposit spike detected: ${recentDeposits.length} deposits in last minute (threshold: ${this.thresholds.maxDepositsPerMinute})`,
          metadata: { count: recentDeposits.length, threshold: this.thresholds.maxDepositsPerMinute },
          timestamp: now,
        });
      }

      // --- Check 2: Volume Spike ---
      const totalVolume = recentDeposits.reduce((sum: bigint, d: any) => {
        try { return sum + BigInt(d.amount); } catch { return sum; }
      }, BigInt(0));

      if (totalVolume > BigInt(this.thresholds.maxDepositVolumePerMinute)) {
        anomalies.push({
          type: 'VOLUME_SPIKE',
          severity: 'CRITICAL',
          message: `Volume spike detected: ${totalVolume.toString()} in last minute`,
          metadata: { volume: totalVolume.toString(), threshold: this.thresholds.maxDepositVolumePerMinute },
          timestamp: now,
        });
      }

      // --- Check 3: High Failure Rate ---
      const recentFailed = recentDeposits.filter((d: any) => d.status === 'FAILED');
      const failureRatio = recentDeposits.length > 0
        ? recentFailed.length / recentDeposits.length
        : 0;

      if (failureRatio > this.thresholds.maxFailedDepositRatio) {
        anomalies.push({
          type: 'HIGH_FAILURE_RATE',
          severity: 'PANIC',
          message: `High failure rate: ${(failureRatio * 100).toFixed(1)}% (threshold: ${this.thresholds.maxFailedDepositRatio * 100}%)`,
          metadata: { failureRatio, failedCount: recentFailed.length, totalCount: recentDeposits.length },
          timestamp: now,
        });
      }

      // --- Check 4: Stale Pending Deposits ---
      const staleThreshold = new Date(now.getTime() - this.thresholds.maxPendingDepositAgeMinutes * 60_000);
      const staleDeposits = await (prisma as any).deposit.findMany({
        where: {
          status: 'PENDING',
          detectedAt: { lt: staleThreshold },
        },
      });

      if (staleDeposits.length > 10) {
        anomalies.push({
          type: 'STALE_DEPOSITS',
          severity: 'WARNING',
          message: `${staleDeposits.length} deposits have been pending for > ${this.thresholds.maxPendingDepositAgeMinutes} minutes`,
          metadata: { staleCount: staleDeposits.length, maxAgeMinutes: this.thresholds.maxPendingDepositAgeMinutes },
          timestamp: now,
        });
      }

      // --- Check 5: Sinarca Placeholder ---
      // TODO: Integrate with Sinarca API for deforestation anomaly detection
      // if (await this.checkSinarcaAnomaly()) {
      //   anomalies.push({
      //     type: 'SINARCA_ALERT',
      //     severity: 'PANIC',
      //     message: 'Sinarca detected irregular forest activity',
      //     metadata: {},
      //     timestamp: now,
      //   });
      // }

      // --- Action: Trigger Panic if CRITICAL or PANIC anomalies found ---
      const panicAnomalies = anomalies.filter(a => a.severity === 'PANIC');
      const criticalAnomalies = anomalies.filter(a => a.severity === 'CRITICAL');

      if (panicAnomalies.length > 0) {
        await this.triggerPanic(panicAnomalies[0]);
      } else if (criticalAnomalies.length > 2) {
        // Multiple critical anomalies = escalate to panic
        await this.triggerPanic({
          type: 'MULTIPLE_CRITICAL',
          severity: 'PANIC',
          message: `Multiple critical anomalies detected: ${criticalAnomalies.map(a => a.type).join(', ')}`,
          metadata: { anomalies: criticalAnomalies },
          timestamp: now,
        });
      }

      // Store anomalies in history
      this.anomalyHistory.push(...anomalies);
      if (this.anomalyHistory.length > this.MAX_HISTORY_SIZE) {
        this.anomalyHistory = this.anomalyHistory.slice(-this.MAX_HISTORY_SIZE);
      }

      this.lastCheckAt = now;

      if (anomalies.length > 0) {
        console.warn(`[SecurityWatchdog] Detected ${anomalies.length} anomalies:`,
          anomalies.map(a => `${a.type}(${a.severity})`).join(', ')
        );
      }

      return anomalies;
    } catch (err) {
      console.error('[SecurityWatchdog] Error during anomaly check:', err);
      return [];
    }
  }

  /**
   * Triggers the panic button: pauses all chains via CircuitBreaker.
   */
  async triggerPanic(anomaly: AnomalyReport): Promise<void> {
    console.error(`[SecurityWatchdog] PANIC TRIGGERED: ${anomaly.message}`);

    try {
      await this.circuitBreaker.pauseAllChains(
        'SecurityWatchdogService',
        anomaly.message
      );

      // Create AuditLog entry
      await (prisma as any).auditLog.create({
        data: {
          action: 'PANIC_TRIGGERED',
          resourceType: 'CIRCUIT_BREAKER',
          metadata: {
            anomalyType: anomaly.type,
            message: anomaly.message,
            metadata: anomaly.metadata,
          },
          timestamp: new Date(),
        },
      });
    } catch (err) {
      console.error('[SecurityWatchdog] Failed to trigger circuit breaker:', err);
    }
  }

  /**
   * Placeholder for Sinarca integration.
   * Returns true if an anomaly is detected in forest monitoring data.
   */
  async checkSinarcaAnomaly(): Promise<boolean> {
    // TODO: Implement Sinarca API call
    // const sinarcaApiUrl = process.env.SINARCA_API_URL;
    // if (!sinarcaApiUrl) return false;
    // const response = await fetch(`${sinarcaApiUrl}/anomalies/latest`);
    // const data = await response.json();
    // return data.anomalyDetected === true;
    return false;
  }

  /**
   * Returns recent anomaly history.
   */
  getAnomalyHistory(limit: number = 100): AnomalyReport[] {
    return this.anomalyHistory.slice(-limit);
  }

  /**
   * Updates thresholds at runtime.
   */
  updateThresholds(newThresholds: Partial<WatchdogThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    console.log('[SecurityWatchdog] Thresholds updated:', this.thresholds);
  }

  getThresholds(): WatchdogThresholds {
    return { ...this.thresholds };
  }
}

