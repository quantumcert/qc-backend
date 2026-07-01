// src/routes/v1/webhookRoutes.ts
import { Router } from 'express';
import { WebhookController } from '../../controllers/WebhookController';
import { ReceivablesWebhookController } from '../../controllers/ReceivablesWebhookController';

const router = Router();

/**
 * @openapi
 * /api/v1/webhooks/mercadopago:
 *   post:
 *     summary: MercadoPago payment webhook
 *     description: |
 *       Public endpoint (no API key required). Authenticity is verified via
 *       HMAC SHA-256 of the raw payload against the `MP_WEBHOOK_SECRET`.
 *       Confirmed payments trigger automatic completion of pending asset transfers.
 *
 *       MercadoPago retries failed deliveries up to 3 times with exponential backoff.
 *       Respond with `200` as quickly as possible — heavy processing is async.
 *     tags: [Webhooks]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: x-signature
 *         required: true
 *         schema:
 *           type: string
 *           example: "ts=1719500000,v1=abc123def456..."
 *         description: HMAC SHA-256 signature sent by MercadoPago.
 *       - in: header
 *         name: x-request-id
 *         schema:
 *           type: string
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Standard MercadoPago webhook payload.
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [payment.created, payment.updated]
 *                 example: "payment.updated"
 *               data:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     example: "123456789"
 *           example:
 *             action: "payment.updated"
 *             data:
 *               id: "123456789"
 *     responses:
 *       200:
 *         description: Webhook received and processing queued.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Invalid HMAC signature — request rejected.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/mercadopago', WebhookController.handleMercadoPago);
router.post('/receivables/:provider', ReceivablesWebhookController.handleProviderWebhook);

export default router;
