// Device routes - EIP-2535 Diamond Pattern

import { Router } from 'express';
import { DeviceController } from '../../controllers/DeviceController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
import rateLimit from 'express-rate-limit';

const router = Router();

const nfcValidateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many NFC validation attempts from this IP, please try again after a minute' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @openapi
 * /api/v1/devices:
 *   post:
 *     summary: Registrar novo dispositivo NFC/RFID
 *     tags: [Devices]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - uid
 *               - assetId
 *             properties:
 *               uid:
 *                 type: string
 *                 description: UID físico do chip NFC/RFID
 *                 example: 04:AB:CD:EF:12:34:56
 *               assetId:
 *                 type: string
 *                 format: uuid
 *                 description: ID do ativo vinculado ao dispositivo
 *     responses:
 *       201:
 *         description: Dispositivo registrado e vinculado ao ativo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role insuficiente (requer ADMIN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireAdmin, DeviceController.register);

/**
 * @openapi
 * /api/v1/devices/tap:
 *   get:
 *     summary: Validar toque NFC (público ou autenticado)
 *     description: |
 *       Endpoint de validação de tap NFC. Aceita requisições sem API key (validação pública via URL)
 *       ou com API key (validação autenticada). Limitado a 5 requisições/min por IP.
 *     tags: [Devices]
 *     security:
 *       - ApiKeyAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *         description: UID do chip NFC lido
 *         example: 04ABCDEF123456
 *       - in: query
 *         name: counter
 *         schema:
 *           type: integer
 *         description: Contador de taps do chip (anti-clone)
 *     responses:
 *       200:
 *         description: Tap validado — retorna dados do ativo vinculado
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       404:
 *         description: Dispositivo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Muitas tentativas — aguarde 1 minuto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/tap', nfcValidateLimiter, optionalApiKey, tenantRateLimiter, DeviceController.validateTap);

export default router;
