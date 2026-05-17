// ═══════════════════════════════════════════════════════════
// ROUTE: Agent Event
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// POST /api/v1/agent/event — machine-to-machine event submission.
// Requires ApiKey (linked to Agent) + Falcon-512 payload signature.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireOperator } from '../../middleware/rbacGuard';
import { requireApiKeyScope } from '../../middleware/apiKeyScopeGuard';
import { requireAgentSignature } from '../../middleware/requireAgentSignature';
import { AgentController } from '../../controllers/AgentController';

const router = Router();

/**
 * @openapi
 * /api/v1/agent/event:
 *   post:
 *     summary: Submit a machine-to-machine event
 *     description: |
 *       Authenticated by an Agent ApiKey + Falcon-512 payload signature.
 *       The selector must be in the Agent's allowedSelectors list.
 *     tags: [Agents]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [selector, assetId, payload, signature]
 *             properties:
 *               selector:
 *                 type: string
 *                 example: event.recordAuthenticated
 *               assetId:
 *                 type: string
 *               payload:
 *                 type: object
 *               signature:
 *                 type: string
 *                 description: Falcon-512 signature of JSON.stringify({selector,assetId,payload}) in base64
 *     responses:
 *       200:
 *         description: Event accepted and queued for anchoring
 *       403:
 *         description: Invalid signature, revoked agent, or unauthorized selector
 */
router.post(
  '/event',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireOperator,
  requireApiKeyScope('agents:write'),
  requireAgentSignature,
  AgentController.handleEvent,
);

export default router;
