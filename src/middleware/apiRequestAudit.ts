import { NextFunction, Response } from 'express';
import prisma from '../config/prisma';
import { AuthenticatedRequest } from '../types';

const API_KEY_PATTERN = /qc_(?:test|live)_[A-Za-z0-9_-]+/g;

export const apiRequestAudit = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    const startedAt = Date.now();

    res.on('finish', () => {
        if (!req.tenantId || !req.apiKeyId) return;

        const latencyMs = Math.max(0, Date.now() - startedAt);
        const path = stripQuery(req.originalUrl || req.url);
        const selector = extractSelector(req);
        const sanitizedError = res.statusCode >= 400
            ? sanitizeError(req.apiRequestAuditError || res.statusMessage)
            : undefined;

        void persistAudit({
            tenantId: req.tenantId,
            apiKeyId: req.apiKeyId,
            keyPrefix: req.apiKeyPrefix,
            role: req.apiKeyRole,
            method: req.method,
            path,
            selector,
            statusCode: res.statusCode,
            latencyMs,
            correlationId: req.correlationId,
            sanitizedError,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    });

    next();
};

async function persistAudit(params: {
    tenantId: string;
    apiKeyId: string;
    keyPrefix?: string;
    role?: string;
    method: string;
    path: string;
    selector?: string;
    statusCode: number;
    latencyMs: number;
    correlationId?: string;
    sanitizedError?: string;
    ipAddress?: string;
    userAgent?: string | string[];
}) {
    try {
        await Promise.all([
            prisma.apiRequestAudit.create({
                data: {
                    tenantId: params.tenantId,
                    apiKeyId: params.apiKeyId,
                    keyPrefix: params.keyPrefix,
                    role: params.role,
                    method: params.method,
                    path: params.path,
                    selector: params.selector,
                    statusCode: params.statusCode,
                    latencyMs: params.latencyMs,
                    correlationId: params.correlationId,
                    sanitizedError: params.sanitizedError,
                    ipAddress: params.ipAddress,
                    userAgent: normalizeUserAgent(params.userAgent),
                },
            }),
            prisma.apiKey.update({
                where: { id: params.apiKeyId },
                data: { lastUsedAt: new Date() },
            }),
        ]);
    } catch (error) {
        console.warn('[ApiRequestAudit] Failed to persist audit record:', error);
    }
}

function extractSelector(req: AuthenticatedRequest): string | undefined {
    const selector = req.body?.selector;
    return typeof selector === 'string' && selector.trim() ? selector.trim() : undefined;
}

function stripQuery(url: string): string {
    return url.split('?')[0] || '/';
}

function normalizeUserAgent(value?: string | string[]): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

function sanitizeError(value?: string): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    return normalized.replace(API_KEY_PATTERN, '[REDACTED_API_KEY]').slice(0, 500);
}
