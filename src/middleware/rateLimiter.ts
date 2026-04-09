// ═══════════════════════════════════════════════════════════
// MIDDLEWARE: Tenant Rate Limiter
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Per-Tenant rate limiting middleware.
// Must be used AFTER apiKeyAuth middleware (requires tenant context).
//
// Enforces plan-based limits:
//   FREE: 10 req/min, 500 req/day
//   PROFESSIONAL: 60 req/min, 10K req/day
//   ENTERPRISE: 1000 req/min, 1M req/day
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { RateLimiterFacet } from '../services/core-facets/RateLimiterFacet';
import { AuthenticatedRequest } from '../types';

// ─── TENANT RATE LIMITER ────────────────────────────────
// Checks rate limits for the authenticated tenant.
// Returns 429 Too Many Requests if limits are exceeded.
export const tenantRateLimiter = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        // Skip rate limiting if no tenant context (unauthenticated request)
        if (!req.tenantId) {
            return next();
        }

        // Fetch tenant to get plan tier and custom limits
        const tenant = await prisma.tenant.findUnique({
            where: { id: req.tenantId },
            select: {
                id: true,
                planTier: true,
                maxRequestsPerMinute: true,
                maxRequestsPerDay: true,
            },
        });

        if (!tenant) {
            return res.status(403).json({
                success: false,
                error: 'Tenant not found.',
            });
        }

        // Check and increment rate limit counters
        const result = await RateLimiterFacet.checkAndIncrement({
            tenantId: tenant.id,
            planTier: tenant.planTier,
            customMinuteLimit: tenant.maxRequestsPerMinute,
            customDailyLimit: tenant.maxRequestsPerDay,
        });

        // Set rate limit headers (X-RateLimit-* standard)
        res.set({
            'X-RateLimit-Limit-Minute': String(result.minuteLimit),
            'X-RateLimit-Remaining-Minute': String(Math.max(0, result.minuteLimit - result.currentMinuteCount)),
            'X-RateLimit-Limit-Day': String(result.dailyLimit),
            'X-RateLimit-Remaining-Day': String(Math.max(0, result.dailyLimit - result.currentDailyCount)),
        });

        if (!result.allowed) {
            res.set('Retry-After', String(result.retryAfterSeconds || 60));
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Please try again later.',
                code: 'RATE_LIMIT_EXCEEDED',
                limits: {
                    minuteLimit: result.minuteLimit,
                    currentMinuteCount: result.currentMinuteCount,
                    dailyLimit: result.dailyLimit,
                    currentDailyCount: result.currentDailyCount,
                    retryAfterSeconds: result.retryAfterSeconds,
                },
            });
        }

        next();
    } catch (error) {
        console.error('[RateLimiter] Error:', error);
        // Fail-open: if rate limiter encounters an error, allow the request
        // but log for monitoring. This prevents rate limiter failures from
        // blocking all API traffic.
        next();
    }
};
