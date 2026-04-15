// ═══════════════════════════════════════════════════════════
// ASSET ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Agnostic Asset Engine
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { AssetController } from '../../controllers/AssetController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator, requireReader } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
import transferRoutes from './transferRoutes';

const router = Router();

// CRUD operations (Protect by Role)
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, AssetController.create);
router.get('/', requireApiKey, tenantRateLimiter, requireReader, AssetController.list);
router.get('/:id', requireApiKey, tenantRateLimiter, requireReader, AssetController.getById);

// Owner management
router.patch('/:id/owners', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, AssetController.addOwner);

// Transfer management
router.use('/', transferRoutes);

export default router;
