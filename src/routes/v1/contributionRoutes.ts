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
 *     summary: Review a pending public contribution
 *     description: |
 *       Approves or rejects a pending contribution submitted via the public endpoint.
 *       The contribution must belong to the same tenant as the authenticating API key.
 *       Requires OPERATOR or ADMIN role and the `events:write` scope.
 *     tags: [Curation]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "c7f3a1b2-d4e5-6789-abcd-ef0123456789"
 *         description: PendingContribution ID.
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
 *                 example: "APPROVED"
 *               reason:
 *                 type: string
 *                 nullable: true
 *                 example: "Evidence verified against physical inspection report."
 *           example:
 *             decision: "APPROVED"
 *             reason: "Evidence verified against physical inspection report."
 *     responses:
 *       200:
 *         description: Contribution reviewed.
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
 *                       format: uuid
 *                       example: "c7f3a1b2-d4e5-6789-abcd-ef0123456789"
 *                     status:
 *                       type: string
 *                       enum: [APPROVED, REJECTED]
 *                       example: "APPROVED"
 *                     eventId:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                       example: "e1f2a3b4-c5d6-7890-abcd-ef1234567890"
 *       400:
 *         description: Invalid decision value.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *       404:
 *         description: Contribution not found for this tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Contribution already reviewed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/review', requireApiKey, tenantRateLimiter, requireOperator, requireApiKeyScope('events:write'), ContributionController.review);

export default router;
