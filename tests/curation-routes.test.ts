// tests/curation-routes.test.ts
// TDD tests for curation routes (public + authenticated)
// Covers: CORE-05 POST /api/v1/public/asset/:assetId/contribution
//         CORE-06 POST /api/v1/contributions/:id/review

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mock middleware ─────────────────────────────────────────────────────────
vi.mock('../src/middleware/apiKeyAuth', () => ({
    requireApiKey: (req: any, res: any, next: any) => {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.tenantId = 'tenant-1';
        req.apiKeyId = 'key-1';
        req.apiKeyRole = req.headers['x-role-override'] ?? 'OPERATOR';
        req.apiKeyPrefix = 'qc_test';
        next();
    },
    optionalApiKey: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/rateLimiter', () => ({
    tenantRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/rbacGuard', () => ({
    requireAdmin: (req: any, res: any, next: any) => {
        if (req.apiKeyRole !== 'ADMIN') {
            return res.status(403).json({ success: false, error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
        }
        next();
    },
    requireOperator: (req: any, res: any, next: any) => {
        if (req.apiKeyRole !== 'ADMIN' && req.apiKeyRole !== 'OPERATOR') {
            return res.status(403).json({ success: false, error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
        }
        next();
    },
    requireReader: (_req: any, _res: any, next: any) => next(),
    requireRole: (_role: string) => (_req: any, _res: any, next: any) => next(),
}));

// ── Mock CurationFacet ──────────────────────────────────────────────────────
vi.mock('../src/services/core-facets/CurationFacet', () => ({
    CurationFacet: {
        submitContribution: vi.fn(),
        reviewContribution: vi.fn(),
    },
}));

// ── Mock other services (to avoid env var requirements) ────────────────────
vi.mock('../src/config/prisma', () => ({
    default: {
        asset: { findUnique: vi.fn() },
        contributor: { findUnique: vi.fn() },
        eventLog: { create: vi.fn() },
        pendingContribution: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
        $transaction: vi.fn(async (cb) => cb({})),
    },
}));

vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: { processQueue: vi.fn().mockResolvedValue({}) },
}));

// ── Import app AFTER mocks ──────────────────────────────────────────────────
import { app } from '../src/server';
import { CurationFacet } from '../src/services/core-facets/CurationFacet';

const VALID_ASSET_ID = 'asset-001';
const VALID_PENDING_ID = 'pending-001';

beforeEach(() => {
    vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────
// POST /api/v1/public/asset/:assetId/contribution
// ───────────────────────────────────────────────────────────
describe('POST /api/v1/public/asset/:assetId/contribution', () => {
    // Test 1: non-auditor payload válido → 201
    it('Test 1: payload válido retorna 201 com queued:false e pendingId', async () => {
        (CurationFacet.submitContribution as any).mockResolvedValue({
            queued: false,
            pendingId: VALID_PENDING_ID,
        });

        const res = await request(app)
            .post(`/api/v1/public/asset/${VALID_ASSET_ID}/contribution`)
            .send({ phone: '+5511999999999', payload: { notes: 'test' } });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.queued).toBe(false);
        expect(res.body.data.pendingId).toBe(VALID_PENDING_ID);
    });

    // Test 2: assetId inexistente → 404
    it('Test 2: assetId inexistente retorna 404', async () => {
        (CurationFacet.submitContribution as any).mockRejectedValue(
            Object.assign(new Error('Asset not found'), { code: 'ASSET_NOT_FOUND', httpStatus: 404 })
        );

        const res = await request(app)
            .post('/api/v1/public/asset/nonexistent/contribution')
            .send({ phone: '+5511999999999', payload: {} });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('ASSET_NOT_FOUND');
    });

    // Test 3: sem phone nem email → 400
    it('Test 3: sem phone nem email retorna 400', async () => {
        (CurationFacet.submitContribution as any).mockRejectedValue(
            Object.assign(new Error('phone or email required'), { code: 'INVALID_PAYLOAD', httpStatus: 400 })
        );

        const res = await request(app)
            .post(`/api/v1/public/asset/${VALID_ASSET_ID}/contribution`)
            .send({ payload: {} });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('INVALID_PAYLOAD');
    });
});

// ───────────────────────────────────────────────────────────
// POST /api/v1/contributions/:id/review
// ───────────────────────────────────────────────────────────
describe('POST /api/v1/contributions/:id/review', () => {
    // Test 4: OPERATOR aprova → 200 com status APPROVED e eventId
    it('Test 4: OPERATOR + decision=APPROVED retorna 200 com { status: APPROVED, eventId }', async () => {
        (CurationFacet.reviewContribution as any).mockResolvedValue({
            pendingId: VALID_PENDING_ID,
            status: 'APPROVED',
            eventId: 'evt-001',
        });

        const res = await request(app)
            .post(`/api/v1/contributions/${VALID_PENDING_ID}/review`)
            .set('x-api-key', 'qc_test_key')
            .send({ decision: 'APPROVED' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('APPROVED');
        expect(res.body.data.eventId).toBe('evt-001');
    });

    // Test 5: sem API key → 401
    it('Test 5: sem API key retorna 401', async () => {
        const res = await request(app)
            .post(`/api/v1/contributions/${VALID_PENDING_ID}/review`)
            .send({ decision: 'APPROVED' });

        expect(res.status).toBe(401);
    });

    // Test 6: role READER → 403
    it('Test 6: role READER retorna 403', async () => {
        const res = await request(app)
            .post(`/api/v1/contributions/${VALID_PENDING_ID}/review`)
            .set('x-api-key', 'qc_test_key')
            .set('x-role-override', 'READER')
            .send({ decision: 'APPROVED' });

        expect(res.status).toBe(403);
    });

    // Test 7: pendingId de outro tenant → 404
    it('Test 7: pendingId de outro tenant retorna 404', async () => {
        (CurationFacet.reviewContribution as any).mockRejectedValue(
            Object.assign(new Error('Contribution not found'), { code: 'CONTRIBUTION_NOT_FOUND', httpStatus: 404 })
        );

        const res = await request(app)
            .post(`/api/v1/contributions/other-tenant-pending/review`)
            .set('x-api-key', 'qc_test_key')
            .send({ decision: 'APPROVED' });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('CONTRIBUTION_NOT_FOUND');
    });
});
