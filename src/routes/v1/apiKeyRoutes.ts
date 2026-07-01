// ═══════════════════════════════════════════════════════════
// ROUTES: API Key Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ApiKeyController } from '../../controllers/ApiKeyController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.use(requireApiKey, tenantRateLimiter, requireAdmin);

/**
 * @openapi
 * /api/v1/api-keys:
 *   post:
 *     summary: Generate a new API key for a tenant
 *     description: |
 *       Creates a new API key bound to the specified tenant with the given RBAC role.
 *       The raw key value is returned **once only** — store it immediately.
 *       Requires ADMIN role.
 *     tags: [API Keys]
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
 *         description: UUIDv4 to prevent duplicate key generation on retries.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateApiKeyPayload'
 *           example:
 *             tenantId: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *             label: "Production integration key"
 *             role: "OPERATOR"
 *     responses:
 *       201:
 *         description: API key generated. The raw `key` value is shown exactly once — save it immediately.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         rawKey:
 *                           type: string
 *                           example: "qc_live_a3f9b2e1d4c7f809101112131415161718192021222324252627"
 *                           description: Raw key value — shown once, never stored in plaintext.
 *                         apiKey:
 *                           $ref: '#/components/schemas/ApiKey'
 *       401:
 *         description: Missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient role — ADMIN required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Duplicate Idempotency-Key — request already processed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', ApiKeyController.generate);

/**
 * @openapi
 * /api/v1/api-keys/{tenantId}:
 *   get:
 *     summary: List API keys for a tenant
 *     description: Returns all API keys for the given tenant. Raw key values are never returned.
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *       - in: query
 *         name: includeRevoked
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include revoked keys in the result.
 *     responses:
 *       200:
 *         description: API key list (raw values never returned).
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ApiKey'
 *       401:
 *         description: Missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:tenantId', ApiKeyController.list);

/**
 * @openapi
 * /api/v1/api-keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     description: Permanently deactivates an API key. This action is irreversible.
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     responses:
 *       200:
 *         description: API key revoked successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: API key not found or does not belong to your tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', ApiKeyController.revoke);

/**
 * @openapi
 * /api/v1/api-keys/{id}/rotate:
 *   post:
 *     summary: Rotate an API key
 *     description: |
 *       Revokes the current key and issues a new one with the same role and configuration.
 *       The previous key is invalidated **immediately**. The new raw key is returned once only.
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440001"
 *         description: UUIDv4 to prevent duplicate rotations on retries.
 *     responses:
 *       200:
 *         description: New key issued. The previous key is immediately invalidated.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         rawKey:
 *                           type: string
 *                           example: "qc_live_b8e2c4f1a9d3e605060708091011121314151617181920212223"
 *                           description: New raw key — shown once, never stored in plaintext.
 *                         previousKeyId:
 *                           type: string
 *                           format: uuid
 *                           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *       404:
 *         description: API key not found or already revoked.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/rotate', ApiKeyController.rotate);

export default router;
