// ═══════════════════════════════════════════════════════════
// ROUTES: Tenant Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// All Tenant operations require ADMIN-level API key.
//
// Endpoints:
//   POST   /v1/tenants                → Create Tenant
//   GET    /v1/tenants                → List Tenants
//   GET    /v1/tenants/:id            → Get Tenant by ID
//   PATCH  /v1/tenants/:id            → Update Tenant
//   POST   /v1/tenants/:id/deactivate → Deactivate Tenant
//   POST   /v1/tenants/:id/reactivate → Reactivate Tenant
//   GET    /v1/tenants/:id/usage      → Get Rate Limit Usage
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { TenantController } from '../../controllers/TenantController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

// All tenant management routes require ADMIN API key + rate limiting
router.use(requireApiKey, tenantRateLimiter, requireAdmin);

router.post('/', TenantController.create);
router.get('/', TenantController.list);
router.get('/:id', TenantController.getById);
router.patch('/:id', TenantController.update);
router.post('/:id/deactivate', TenantController.deactivate);
router.post('/:id/reactivate', TenantController.reactivate);
router.get('/:id/usage', TenantController.getUsage);

export default router;
