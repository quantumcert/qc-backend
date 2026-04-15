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

/**
 * @openapi
 * /api/v1/tenants:
 *   post:
 *     summary: Create a new Tenant
 *     tags:
 *       - Tenants
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTenantPayload'
 *     responses:
 *       '201':
 *         description: Tenant created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '400':
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   get:
 *     summary: List all Tenants
 *     tags:
 *       - Tenants
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       '200':
 *         description: List of tenants
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', TenantController.create);
router.get('/', TenantController.list);
router.get('/:id', TenantController.getById);
router.patch('/:id', TenantController.update);
router.post('/:id/deactivate', TenantController.deactivate);
router.post('/:id/reactivate', TenantController.reactivate);
router.get('/:id/usage', TenantController.getUsage);

export default router;
