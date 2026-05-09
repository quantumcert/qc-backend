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
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

// POST /api/v1/contributions/:id/review
// Approve or reject a pending contribution.
// Chain: requireApiKey → tenantRateLimiter → requireOperator → handler
router.post('/:id/review', requireApiKey, tenantRateLimiter, requireOperator, ContributionController.review);

export default router;
