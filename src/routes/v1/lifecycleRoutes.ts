// ═══════════════════════════════════════════════════════════
// ROUTE: Asset Lifecycle
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { LifecycleController } from '../../controllers/LifecycleController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

const router = Router();

/**
 * @openapi
 * /api/v1/assets/{assetId}/lifecycle:
 *   patch:
 *     summary: Transicionar estado do ativo
 *     description: |
 *       Máquina de estados do ativo. Transições permitidas:
 *       - `DRAFT → ACTIVE`
 *       - `ACTIVE → SUSPENDED → ACTIVE`
 *       - `ACTIVE → ARCHIVED`
 *       - `ACTIVE → BURNED` (terminal, irreversível)
 *       - `ACTIVE → AWAITING_PAYMENT` (gerenciado pelo BillingFacet)
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
 *             $ref: '#/components/schemas/LifecycleTransitionPayload'
 *     responses:
 *       200:
 *         description: Transição executada com sucesso. EventLog registrado.
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
 *         description: Transição inválida para o estado atual do ativo
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
  '/:assetId/lifecycle',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireOperator,
  LifecycleController.transition,
);

export default router;
