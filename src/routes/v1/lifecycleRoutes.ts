// ═══════════════════════════════════════════════════════════
// ROUTE: Asset Lifecycle
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// PATCH /api/v1/assets/:assetId/lifecycle
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

// PATCH /api/v1/assets/:assetId/lifecycle
router.patch('/:assetId/lifecycle',
    requireApiKey,
    requireIdempotency,
    tenantRateLimiter,
    requireOperator,
    LifecycleController.transition
);

export default router;
