// ═══════════════════════════════════════════════════════════
// ASSET ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { AssetController } from '../../controllers/AssetController';
import { TransferController } from '../../controllers/TransferController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator, requireReader } from '../../middleware/rbacGuard';
import { requireApiKeyScope } from '../../middleware/apiKeyScopeGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
const router = Router();

/**
 * @openapi
 * /api/v1/assets:
 *   post:
 *     summary: Register a new asset
 *     description: |
 *       Creates a new asset with the provided metadata. A SHA3-512 hash of the metadata
 *       is computed automatically and stored as the asset's integrity fingerprint.
 *       Requires OPERATOR or ADMIN role and the `assets:write` scope.
 *     tags: [Assets]
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
 *         description: UUIDv4 to prevent duplicate asset creation on retries.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAssetPayload'
 *           example:
 *             metadata:
 *               type: "product"
 *               sku: "SKU-001"
 *               serial: "SN-XYZ-2026"
 *               brand: "Acme"
 *     responses:
 *       201:
 *         description: Asset registered. SHA3-512 hash computed and stored automatically.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       401:
 *         description: Missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient role — OPERATOR or ADMIN required.
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
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, requireApiKeyScope('assets:write'), AssetController.create);

/**
 * @openapi
 * /api/v1/assets:
 *   get:
 *     summary: List tenant assets
 *     description: Returns a paginated list of assets belonging to the authenticated tenant.
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, ACTIVE, SUSPENDED, ARCHIVED, BURNED, AWAITING_PAYMENT]
 *           example: "ACTIVE"
 *         description: Filter by asset status.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           example: 20
 *     responses:
 *       200:
 *         description: Paginated asset list.
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
 *                         $ref: '#/components/schemas/Asset'
 *       401:
 *         description: Missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', requireApiKey, tenantRateLimiter, requireReader, requireApiKeyScope('assets:read'), AssetController.list);

/**
 * @openapi
 * /api/v1/assets/{id}:
 *   get:
 *     summary: Get asset by ID
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: Asset found.
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
 *         description: Asset not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', requireApiKey, tenantRateLimiter, requireReader, requireApiKeyScope('assets:read'), AssetController.getById);

/**
 * @openapi
 * /api/v1/assets/{id}/owners:
 *   patch:
 *     summary: Add an owner to an asset
 *     description: Links an additional owner identity to an existing asset. Requires OPERATOR or ADMIN role.
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440002"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ownerId
 *             properties:
 *               ownerId:
 *                 type: string
 *                 format: uuid
 *                 example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *               role:
 *                 type: string
 *                 example: "PRIMARY"
 *           example:
 *             ownerId: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *             role: "PRIMARY"
 *     responses:
 *       200:
 *         description: Owner added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Asset not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id/owners', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, requireApiKeyScope('assets:write'), AssetController.addOwner);

/**
 * @openapi
 * /api/v1/assets/{assetId}/transfer:
 *   patch:
 *     summary: Initiate an ownership transfer via MercadoPago
 *     description: |
 *       Creates a Shadow Account for the buyer, transitions the asset to
 *       `AWAITING_PAYMENT`, and returns a MercadoPago payment link. Once the payment
 *       is confirmed via webhook, ownership is transferred automatically.
 *
 *       Requires OPERATOR or ADMIN role and the `transfers:write` scope.
 *       An `X-Idempotency-Key` is required to prevent duplicate transfers.
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       - in: header
 *         name: X-Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440003"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - buyerDocument
 *               - documentType
 *             properties:
 *               buyerDocument:
 *                 type: string
 *                 description: Buyer's CPF or CNPJ (formatted or unformatted).
 *                 example: "123.456.789-01"
 *               documentType:
 *                 type: string
 *                 enum: [CPF, CNPJ]
 *                 example: "CPF"
 *           example:
 *             buyerDocument: "123.456.789-01"
 *             documentType: "CPF"
 *     responses:
 *       200:
 *         description: Transfer initiated — returns `paymentLink` and asset status `AWAITING_PAYMENT`.
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
 *                         paymentLink:
 *                           type: string
 *                           example: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123456789-abc"
 *                         assetStatus:
 *                           type: string
 *                           example: "AWAITING_PAYMENT"
 *       401:
 *         description: Missing or invalid API key.
 *       403:
 *         description: Insufficient role — OPERATOR or ADMIN required.
 *       404:
 *         description: Asset not found or does not belong to this tenant.
 *       422:
 *         description: Asset cannot be transferred in its current state.
 */
router.patch('/:assetId/transfer',
  requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, requireApiKeyScope('transfers:write'),
  TransferController.initiateTransfer);

export default router;
