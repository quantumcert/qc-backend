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
 *     summary: Registrar um novo ativo
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAssetPayload'
 *     responses:
 *       201:
 *         description: Ativo registrado. Hash SHA3-512 gerado automaticamente.
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
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role insuficiente (requer OPERATOR ou ADMIN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Idempotency key duplicada
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
 *     summary: Listar ativos do tenant
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, ACTIVE, SUSPENDED, ARCHIVED, BURNED, AWAITING_PAYMENT]
 *         description: Filtrar por status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Lista paginada de ativos
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
 *         description: API key ausente ou inválida
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
 *     summary: Buscar ativo por ID
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
 *     responses:
 *       200:
 *         description: Ativo encontrado
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
 *         description: Ativo não encontrado
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
 *     summary: Adicionar proprietário ao ativo
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
 *               - ownerId
 *             properties:
 *               ownerId:
 *                 type: string
 *                 format: uuid
 *               role:
 *                 type: string
 *                 example: PRIMARY
 *     responses:
 *       200:
 *         description: Proprietário adicionado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Ativo não encontrado
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
 *     summary: Iniciar transferência de ownership via MercadoPago
 *     description: |
 *       Cria um Shadow Account para o comprador, muda o Asset para AWAITING_PAYMENT
 *       e retorna o link de pagamento MercadoPago. Somente OPERATOR ou ADMIN.
 *       Requer X-Idempotency-Key para evitar transferências duplicadas.
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
 *       - in: header
 *         name: X-Idempotency-Key
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
 *               - buyerDocument
 *               - documentType
 *             properties:
 *               buyerDocument:
 *                 type: string
 *                 description: CPF ou CNPJ do comprador (aceita máscara)
 *                 example: "123.456.789-01"
 *               documentType:
 *                 type: string
 *                 enum: [CPF, CNPJ]
 *     responses:
 *       200:
 *         description: Transfer iniciada — retorna paymentLink e status AWAITING_PAYMENT
 *       401:
 *         description: API key ausente ou inválida
 *       403:
 *         description: Role insuficiente (requer OPERATOR ou ADMIN)
 *       404:
 *         description: Asset não encontrado ou não pertence ao tenant
 *       422:
 *         description: Asset não pode ser transferido no estado atual
 */
router.patch('/:assetId/transfer',
  requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, requireApiKeyScope('transfers:write'),
  TransferController.initiateTransfer);

export default router;
