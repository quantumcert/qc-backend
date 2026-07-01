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
 *
 *       ## Signature validation
 *
 *       The `x-signature` header has the form `ts=<unix_seconds>,v1=<hex_hmac>`.
 *
 *       Validation steps:
 *       1. Extract `ts` and `v1` from the header.
 *       2. Reject if `|now - ts| > 300` seconds (5-minute replay window).
 *       3. Build the signed string: `id:<x-request-id>;request-id:<x-request-id>;ts:<ts>;`
 *       4. Compute `HMAC-SHA256(signed_string, MP_WEBHOOK_SECRET)` — compare with `v1`.
 *       5. Reject on mismatch with `401`.
 *
 *       The timestamp check prevents replay attacks: a captured request cannot be
 *       re-delivered more than 5 minutes after its original timestamp.
 *     tags: [Webhooks]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: x-signature
 *         required: true
 *         schema:
 *           type: string
 *           example: "ts=1719500000,v1=abc123def456..."
 *         description: |
 *           HMAC SHA-256 signature sent by MercadoPago.
 *           Format: `ts=<unix_timestamp>,v1=<hex_digest>`.
 *           Reject if `|now - ts| > 300 s` to prevent replay attacks.
 *       - in: header
 *         name: x-request-id
 *         schema:
 *           type: string
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *         description: Unique delivery ID from MercadoPago. Included in the signed string.
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
 *         description: Invalid HMAC signature or timestamp out of the 5-minute replay window.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/mercadopago', WebhookController.handleMercadoPago);

/**
 * @openapi
 * /api/v1/webhooks/receivables/{provider}:
 *   post:
 *     summary: Generic receivables provider webhook
 *     description: |
 *       Accepts payment event webhooks from any configured receivables provider
 *       (e.g. `asaas`, `iugu`, `stripe`). The `provider` path parameter selects
 *       the signature verification strategy and payload parser via `ReceivablesProviderFacet`.
 *
 *       Each provider must be configured with its webhook secret before events are accepted.
 *       Calls from unconfigured providers return `404 PROVIDER_NOT_CONFIGURED`.
 *
 *       Signature verification is provider-specific — refer to the provider's webhook
 *       documentation for the expected header and signing algorithm.
 *     tags: [Webhooks]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           example: "asaas"
 *         description: Receivables provider slug. Must match a configured provider.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Provider-specific webhook payload. Structure varies by provider.
 *           example:
 *             event: "PAYMENT_CONFIRMED"
 *             payment:
 *               id: "pay_abc123"
 *               value: 150.00
 *               status: "CONFIRMED"
 *     responses:
 *       200:
 *         description: Webhook received and recorded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid or malformed provider payload.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *               example:
 *                 success: false
 *                 error: "Invalid payload structure for provider asaas."
 *                 code: "INVALID_PROVIDER_PAYLOAD"
 *       401:
 *         description: Webhook signature verification failed.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *               example:
 *                 success: false
 *                 error: "Webhook signature mismatch."
 *                 code: "INVALID_WEBHOOK_SIGNATURE"
 *       404:
 *         description: Provider not configured.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *               example:
 *                 success: false
 *                 error: "Provider 'unknown' is not configured."
 *                 code: "PROVIDER_NOT_CONFIGURED"
 */
router.post('/receivables/:provider', ReceivablesWebhookController.handleProviderWebhook);

export default router;
