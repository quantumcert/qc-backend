// ═══════════════════════════════════════════════════════════
// CONTRIBUTION ROUTES — CORE-06
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Authenticated routes for reviewing pending contributions.
// Requires OPERATOR role (ADMIN or OPERATOR).
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ContributionController } from '../../controllers/ContributionController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { requireApiKeyScope } from '../../middleware/apiKeyScopeGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

/**
 * @openapi
 * /api/v1/contributions/{id}/review:
 *   post:
 *     summary: Revisar uma contribuição pública pendente
 *     description: |
 *       Endpoint autenticado para revisão de contribuições públicas. Requer API key
 *       OPERATOR ou ADMIN. A contribuição pendente deve pertencer ao mesmo tenant
 *       da API key.
 *     tags: [Curation]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da PendingContribution.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               reason:
 *                 type: string
 *                 nullable: true
 *                 example: "Evidência insuficiente"
 *     responses:
 *       200:
 *         description: Contribuição revisada.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     pendingId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [APPROVED, REJECTED]
 *                     eventId:
 *                       type: string
 *                       nullable: true
 *       400:
 *         description: Decisão inválida.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: API key ausente ou inválida.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role não é OPERATOR ou ADMIN.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Contribuição não encontrada para este tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Contribuição já revisada.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/review', requireApiKey, tenantRateLimiter, requireOperator, requireApiKeyScope('events:write'), ContributionController.review);

export default router;
