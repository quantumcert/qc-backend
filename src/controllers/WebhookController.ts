// src/controllers/WebhookController.ts
import crypto from 'crypto';
import { Request, Response } from 'express';
import prisma from '../config/prisma';

export class WebhookController {
    static async handleMercadoPago(req: Request, res: Response) {
        const signature = req.headers['x-signature'] as string | undefined;
        const requestId = req.headers['x-request-id'] as string | undefined;
        const paymentId = req.query['data.id'] as string | undefined;
        const ts        = req.query['ts'] as string | undefined;

        if (!signature || !requestId || !paymentId || !ts) {
            return res.status(401).json({ success: false, error: 'Missing required webhook headers or query params' });
        }

        const secret = process.env.MP_WEBHOOK_SECRET;
        if (!secret) {
            console.error('[Webhook] MP_WEBHOOK_SECRET is not configured');
            return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
        }

        // Parse signature header: "ts=<ts>,v1=<hash>"
        const parts: Record<string, string> = {};
        for (const part of signature.split(',')) {
            const [key, value] = part.split('=');
            if (key && value) parts[key.trim()] = value.trim();
        }

        const receivedV1 = parts['v1'];
        if (!receivedV1) {
            return res.status(401).json({ success: false, error: 'Invalid signature format' });
        }

        // Reconstruct template and compute expected HMAC
        const template = `id:${paymentId};request-id:${requestId};ts:${ts};`;
        const expectedHash = crypto
            .createHmac('sha256', secret)
            .update(template)
            .digest('hex');

        // Timing-safe comparison to prevent timing attacks
        let receivedBuf: Buffer;
        let expectedBuf: Buffer;
        try {
            receivedBuf = Buffer.from(receivedV1, 'hex');
            expectedBuf = Buffer.from(expectedHash, 'hex');
        } catch {
            return res.status(401).json({ success: false, error: 'Invalid signature encoding' });
        }

        if (expectedBuf.length !== receivedBuf.length ||
            !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
            return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
        }

        // Inbox Pattern: persist BEFORE responding 200
        // If process crashes after this write, the event is recoverable.
        await prisma.webhookInbox.create({
            data: {
                provider: 'MERCADOPAGO',
                rawPayload: req.body,
                status: 'PENDING',
            },
        });

        return res.status(200).json({ success: true });
    }
}
