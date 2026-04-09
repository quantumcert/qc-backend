// ═══════════════════════════════════════════════════════════
// ROUTES: API Key Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// API Key operations. Generation requires ADMIN role.
// Listing/Revocation/Rotation require ADMIN role.
//
// Endpoints:
//   POST   /v1/api-keys              → Generate API Key
//   GET    /v1/api-keys/:tenantId    → List API Keys for Tenant
//   DELETE /v1/api-keys/:id          → Revoke API Key
//   POST   /v1/api-keys/:id/rotate   → Rotate API Key
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ApiKeyController } from '../../controllers/ApiKeyController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

// All API key management routes require ADMIN API key + rate limiting
router.use(requireApiKey, tenantRateLimiter, requireAdmin);

router.post('/', ApiKeyController.generate);
router.get('/:tenantId', ApiKeyController.list);
router.delete('/:id', ApiKeyController.revoke);
router.post('/:id/rotate', ApiKeyController.rotate);

export default router;
