// src/routes/v1/webhookRoutes.ts
import { Router } from 'express';
import { WebhookController } from '../../controllers/WebhookController';

const router = Router();

// POST /api/v1/webhooks/mercadopago
// No apiKeyAuth — external provider call. HMAC validation is inside the controller.
router.post('/mercadopago', WebhookController.handleMercadoPago);

export default router;
