// tests/webhook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { mockWebhookInbox } = vi.hoisted(() => ({
    mockWebhookInbox: { create: vi.fn() },
}));

vi.mock('../src/config/prisma', () => ({
    default: { webhookInbox: mockWebhookInbox }
}));

import { WebhookController } from '../src/controllers/WebhookController';

const SECRET = 'test_webhook_secret_32chars_exact';

function buildSignature(paymentId: string, requestId: string, ts: string, secret = SECRET): string {
    const template = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const hash = crypto.createHmac('sha256', secret).update(template).digest('hex');
    return `ts=${ts},v1=${hash}`;
}

function makeReq(overrides: Partial<{
    headers: Record<string, string>;
    query: Record<string, string>;
    body: Record<string, unknown>;
}> = {}) {
    const ts = '1744000000000';
    const paymentId = 'PAY_001';
    const requestId = 'REQ_abc123';

    return {
        headers: overrides.headers ?? {
            'x-signature': buildSignature(paymentId, requestId, ts),
            'x-request-id': requestId,
        },
        query: overrides.query ?? { 'data.id': paymentId, ts },
        body: { action: 'payment.created', data: { id: paymentId }, ...overrides.body },
    };
}

function makeRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe('WebhookController.handleMercadoPago', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MP_WEBHOOK_SECRET = SECRET;
    });

    it('✅ Persists valid webhook to WebhookInbox and returns 200', async () => {
        mockWebhookInbox.create.mockResolvedValue({ id: 'inbox_001' });
        const req = makeReq() as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true });
        expect(mockWebhookInbox.create).toHaveBeenCalledWith({
            data: {
                provider: 'MERCADOPAGO',
                rawPayload: req.body,
                status: 'PENDING',
            }
        });
    });

    it('🚫 Returns 401 and does NOT persist if HMAC signature is invalid', async () => {
        const req = makeReq({
            headers: {
                'x-signature': 'ts=1744000000000,v1=deadbeefdeadbeef',
                'x-request-id': 'REQ_abc123',
            }
        }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockWebhookInbox.create).not.toHaveBeenCalled();
    });

    it('🚫 Returns 401 when x-signature header is missing', async () => {
        const req = makeReq({ headers: { 'x-request-id': 'REQ_abc123' } }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockWebhookInbox.create).not.toHaveBeenCalled();
    });

    it('🚫 Returns 401 when data.id query param is missing', async () => {
        const req = makeReq({ query: { ts: '1744000000000' } }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('🛡️ Does NOT persist before HMAC validation (no persisted-then-rejected race)', async () => {
        // Signature tampered with wrong secret
        const req = makeReq({
            headers: {
                'x-signature': buildSignature('PAY_001', 'REQ_abc123', '1744000000000', 'wrong_secret'),
                'x-request-id': 'REQ_abc123',
            }
        }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(mockWebhookInbox.create).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
