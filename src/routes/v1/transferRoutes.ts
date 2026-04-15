// ═══════════════════════════════════════════════════════════
// ROUTE: Asset Transfer
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// PATCH /api/v1/assets/:assetId/transfer
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

// PATCH /api/v1/assets/:assetId/transfer
router.patch('/:assetId/transfer',
    requireApiKey,
    requireIdempotency,
    tenantRateLimiter,
    requireOperator,
    TransferController.initiate
);

export default router;
