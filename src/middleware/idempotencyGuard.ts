import { Request, Response, NextFunction } from 'express';
import { validate as isUuid } from 'uuid';

/**
 * Basic in-memory Idempotency Store.
 * In production, this should be backed by Redis or PostgreSQL with a TTL of ~24h.
 */
const idempotencyStore = new Map<string, { timestamp: number, response?: any }>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Middleware to enforce Idempotency on POST/PATCH requests.
 * Requires the 'Idempotency-Key' header to be a valid UUIDv4.
 */
export const requireIdempotency = (req: Request, res: Response, next: NextFunction) => {
    // Only strictly enforce on mutating endpoints
    if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'PUT') {
        return next();
    }

    const idempotencyKey = req.header('Idempotency-Key');

    if (!idempotencyKey) {
        return res.status(400).json({
            success: false,
            error: 'Missing required Idempotency-Key header'
        });
    }

    if (!isUuid(idempotencyKey)) {
        return res.status(400).json({
            success: false,
            error: 'Idempotency-Key must be a valid UUIDv4'
        });
    }

    // Tenant isolation on idempotency keys to prevent cross-tenant key guessing
    const tenantId = (req as any).tenantId || 'anonymous';
    const namespacedKey = `${tenantId}:${idempotencyKey}`;

    const existingRecord = idempotencyStore.get(namespacedKey);

    if (existingRecord) {
        const now = Date.now();
        if (now - existingRecord.timestamp < TTL_MS) {
            // Concurrent request still processing or already processed
            return res.status(409).json({
                success: false,
                error: 'Concurrent or duplicate request detected for this Idempotency-Key',
                cachedResponse: existingRecord.response // Might be undefined if still in-flight
            });
        }
        // Exceeded TTL, we can clear it and proceed (though Map cleanup should handle this ideally)
        idempotencyStore.delete(namespacedKey);
    }

    // Mark as in-flight
    idempotencyStore.set(namespacedKey, { timestamp: Date.now() });

    // Intercept res.json to cache the final response for subsequent replays if needed
    // For this simple implementation, we just return 409 Conflict if they hit it again,
    // which is technically safer against race conditions than full caching without Redis.
    const originalJson = res.json;
    res.json = function (body) {
        if (idempotencyStore.has(namespacedKey)) {
            const record = idempotencyStore.get(namespacedKey)!;
            record.response = body;
            idempotencyStore.set(namespacedKey, record);
        }
        return originalJson.call(this, body);
    };

    next();
};
