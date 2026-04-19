// ═══════════════════════════════════════════════════════════
// ROUTE: Asset Transfer
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { TransferController } from '../../controllers/TransferController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

const router = Router();

/**
 * @openapi
 * /api/v1/assets/{assetId}/transfer:
 *   patch:
 *     summary: Iniciar transferência de propriedade do ativo
 *     description: |
 *       Inicia o fluxo de transferência. O ativo entra em `AWAITING_PAYMENT`.
 *       Após confirmação de pagamento via webhook MercadoPago, o BillingFacet
 *       confirma a transferência e retorna o ativo para `ACTIVE`.
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
 *             $ref: '#/components/schemas/TransferPayload'
 *     responses:
 *       200:
 *         description: Transferência iniciada. Aguardando confirmação de pagamento.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       422:
 *         description: Ativo não está em estado transferível (requer ACTIVE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ativo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch(
  '/:assetId/transfer',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireOperator,
  TransferController.initiate,
);

export default router;
