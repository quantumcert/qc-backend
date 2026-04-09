// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: RateLimiterFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Responsibility: Per-Tenant rate limiting with plan-based thresholds.
// Tracks consumption via database counters (MINUTE and DAILY windows).
//
// Strategy:
//   - FREE tier: Strictly limited (10 req/min, 500 req/day)
//   - PROFESSIONAL: Higher limits (60 req/min, 10K req/day)
//   - ENTERPRISE: Effectively unlimited (1000 req/min, 1M req/day)
//   - Custom overrides via Tenant.maxRequestsPerMinute / maxRequestsPerDay
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import prisma from '../../config/prisma';
import { PlanTier, RateLimitWindow } from '@prisma/client';
import { PLAN_TIER_LIMITS, AuditActions, ResourceTypes, DiamondFacets } from '../../types';

export interface RateLimitResult {
    allowed: boolean;
    currentMinuteCount: number;
    currentDailyCount: number;
    minuteLimit: number;
    dailyLimit: number;
    retryAfterSeconds?: number;
}

export class RateLimiterFacet {

    // ─── CHECK AND INCREMENT ──────────────────────────────
    // Atomically checks if the tenant is within limits and increments counters.
    // Returns whether the request is allowed.
    static async checkAndIncrement(params: {
        tenantId: string;
        planTier: PlanTier;
        customMinuteLimit?: number | null;
        customDailyLimit?: number | null;
    }): Promise<RateLimitResult> {
        const { tenantId, planTier, customMinuteLimit, customDailyLimit } = params;

        // Resolve effective limits
        const defaults = PLAN_TIER_LIMITS[planTier];
        const minuteLimit = customMinuteLimit ?? defaults.maxRequestsPerMinute;
        const dailyLimit = customDailyLimit ?? defaults.maxRequestsPerDay;

        // Generate window keys
        const now = new Date();
        const minuteKey = this.getMinuteKey(now);
        const dailyKey = this.getDailyKey(now);

        // Atomically read-and-increment both counters using upsert
        const [minuteCounter, dailyCounter] = await Promise.all([
            prisma.rateLimitCounter.upsert({
                where: {
                    tenantId_windowType_windowKey: {
                        tenantId,
                        windowType: RateLimitWindow.MINUTE,
                        windowKey: minuteKey,
                    },
                },
                create: {
                    tenantId,
                    windowType: RateLimitWindow.MINUTE,
                    windowKey: minuteKey,
                    requestCount: 1,
                },
                update: {
                    requestCount: { increment: 1 },
                },
            }),
            prisma.rateLimitCounter.upsert({
                where: {
                    tenantId_windowType_windowKey: {
                        tenantId,
                        windowType: RateLimitWindow.DAILY,
                        windowKey: dailyKey,
                    },
                },
                create: {
                    tenantId,
                    windowType: RateLimitWindow.DAILY,
                    windowKey: dailyKey,
                    requestCount: 1,
                },
                update: {
                    requestCount: { increment: 1 },
                },
            }),
        ]);

        const currentMinuteCount = minuteCounter.requestCount;
        const currentDailyCount = dailyCounter.requestCount;

        // Check limits (counter already incremented, so we check <=)
        const minuteExceeded = currentMinuteCount > minuteLimit;
        const dailyExceeded = currentDailyCount > dailyLimit;

        if (minuteExceeded || dailyExceeded) {
            // Calculate retry-after
            const retryAfterSeconds = minuteExceeded
                ? this.secondsUntilNextMinute(now)
                : this.secondsUntilNextDay(now);

            // Audit the rate limit event (non-blocking)
            prisma.auditLog.create({
                data: {
                    tenantId,
                    action: AuditActions.RATE_LIMIT_EXCEEDED,
                    resourceType: ResourceTypes.RATE_LIMIT,
                    metadata: {
                        minuteCount: currentMinuteCount,
                        dailyCount: currentDailyCount,
                        minuteLimit,
                        dailyLimit,
                        windowType: minuteExceeded ? 'MINUTE' : 'DAILY',
                        facet: DiamondFacets.RATE_LIMITER,
                    },
                },
            }).catch(() => { /* Non-critical audit — do not fail the request */ });

            return {
                allowed: false,
                currentMinuteCount,
                currentDailyCount,
                minuteLimit,
                dailyLimit,
                retryAfterSeconds,
            };
        }

        return {
            allowed: true,
            currentMinuteCount,
            currentDailyCount,
            minuteLimit,
            dailyLimit,
        };
    }

    // ─── GET USAGE STATS ──────────────────────────────────
    // Returns current consumption stats for a tenant.
    static async getUsageStats(tenantId: string, planTier: PlanTier) {
        const now = new Date();
        const minuteKey = this.getMinuteKey(now);
        const dailyKey = this.getDailyKey(now);

        const defaults = PLAN_TIER_LIMITS[planTier];

        const [minuteCounter, dailyCounter] = await Promise.all([
            prisma.rateLimitCounter.findUnique({
                where: {
                    tenantId_windowType_windowKey: {
                        tenantId,
                        windowType: RateLimitWindow.MINUTE,
                        windowKey: minuteKey,
                    },
                },
            }),
            prisma.rateLimitCounter.findUnique({
                where: {
                    tenantId_windowType_windowKey: {
                        tenantId,
                        windowType: RateLimitWindow.DAILY,
                        windowKey: dailyKey,
                    },
                },
            }),
        ]);

        return {
            currentMinute: {
                count: minuteCounter?.requestCount ?? 0,
                limit: defaults.maxRequestsPerMinute,
                windowKey: minuteKey,
            },
            currentDay: {
                count: dailyCounter?.requestCount ?? 0,
                limit: defaults.maxRequestsPerDay,
                windowKey: dailyKey,
            },
            planTier,
        };
    }

    // ─── CLEANUP OLD COUNTERS ─────────────────────────────
    // Deletes rate limit counters older than the retention period.
    // Should be called periodically (e.g., daily cron).
    static async cleanupOldCounters(retentionDays = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);

        const deleted = await prisma.rateLimitCounter.deleteMany({
            where: {
                createdAt: { lt: cutoff },
            },
        });

        return { deletedCount: deleted.count };
    }

    // ─── WINDOW KEY GENERATORS ────────────────────────────
    private static getMinuteKey(date: Date): string {
        return date.toISOString().substring(0, 16); // "2026-02-21T00:15"
    }

    private static getDailyKey(date: Date): string {
        return date.toISOString().substring(0, 10); // "2026-02-21"
    }

    private static secondsUntilNextMinute(date: Date): number {
        return 60 - date.getSeconds();
    }

    private static secondsUntilNextDay(date: Date): number {
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        return Math.ceil((endOfDay.getTime() - date.getTime()) / 1000);
    }
}
