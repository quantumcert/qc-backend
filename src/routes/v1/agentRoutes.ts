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
import { requireAgentSignature } from '../../middleware/requireAgentSignature';
import { AgentController } from '../../controllers/AgentController';

const router = Router();

router.post(
  '/event',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireAgentSignature,
  AgentController.handleEvent,
);

export default router;
