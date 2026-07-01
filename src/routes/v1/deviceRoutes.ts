// Device routes - EIP-2535 Diamond Pattern

import { Router } from 'express';
import { DeviceController } from '../../controllers/DeviceController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { requireApiKeyScope } from '../../middleware/apiKeyScopeGuard';
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
 *     summary: Register a new NFC/RFID device
 *     description: |
 *       Registers a physical NFC/RFID chip and links it to an existing asset.
 *       Requires ADMIN role and the `qtags:write` scope.
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
 *           example: "550e8400-e29b-41d4-a716-446655440000"
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
 *                 description: Physical UID of the NFC/RFID chip (colon-separated hex bytes).
 *                 example: "04:AB:CD:EF:12:34:56"
 *               assetId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the asset to link this device to.
 *                 example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *           example:
 *             uid: "04:AB:CD:EF:12:34:56"
 *             assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       201:
 *         description: Device registered and linked to asset.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient role or missing scope.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               insufficient_role:
 *                 summary: Role too low
 *                 value:
 *                   success: false
 *                   error: "Insufficient permissions."
 *                   code: "INSUFFICIENT_PERMISSIONS"
 *               scope_denied:
 *                 summary: Key lacks qtags:write scope
 *                 value:
 *                   success: false
 *                   error: "API key does not have the required scope."
 *                   code: "API_KEY_SCOPE_DENIED"
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireAdmin, requireApiKeyScope('qtags:write'), DeviceController.register);

/**
 * @openapi
 * /api/v1/devices/tap:
 *   get:
 *     summary: Validate an NFC tap (public or authenticated)
 *     description: |
 *       Validates an NFC tap event. Accepts unauthenticated requests (public QR/URL validation)
 *       or authenticated requests with an API key. Limited to 5 requests/min per IP to prevent
 *       brute-force cloning attacks.
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
 *           example: "04ABCDEF123456"
 *         description: NFC chip UID as read by the reader (hex, no separators).
 *       - in: query
 *         name: counter
 *         schema:
 *           type: integer
 *           example: 42
 *         description: Monotonically increasing tap counter for anti-clone protection.
 *     responses:
 *       200:
 *         description: Tap validated — returns the linked asset data.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
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
 *         description: Device not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts — retry after 1 minute (per-IP limit).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Too many NFC validation attempts from this IP, please try again after a minute."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.get('/tap', nfcValidateLimiter, optionalApiKey, tenantRateLimiter, DeviceController.validateTap);

export default router;
