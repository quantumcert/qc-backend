// src/routes/v1/webhookRoutes.ts
import { Router } from 'express';
import { WebhookController } from '../../controllers/WebhookController';
import { ReceivablesWebhookController } from '../../controllers/ReceivablesWebhookController';

const router = Router();

/**
 * @openapi
 * /api/v1/webhooks/mercadopago:
 *   post:
 *     summary: Webhook de pagamento MercadoPago
 *     description: |
 *       Endpoint público (sem API key). A autenticidade é verificada via HMAC SHA-256
 *       do payload com o `MP_WEBHOOK_SECRET`. Pagamentos confirmados disparam a
 *       conclusão da transferência de ativos pendentes.
 *     tags: [Webhooks]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: x-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: Assinatura HMAC SHA-256 enviada pelo MercadoPago
 *       - in: header
 *         name: x-request-id
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Payload padrão do MercadoPago (action, data.id)
 *             example:
 *               action: payment.updated
 *               data:
 *                 id: "123456789"
 *     responses:
 *       200:
 *         description: Webhook processado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Assinatura HMAC inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/mercadopago', WebhookController.handleMercadoPago);
router.post('/receivables/:provider', ReceivablesWebhookController.handleProviderWebhook);

export default router;
