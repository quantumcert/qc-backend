// ═══════════════════════════════════════════════════════════
// ROUTES: Tenant Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// All Tenant operations require ADMIN-level API key.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { TenantController } from '../../controllers/TenantController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.use(requireApiKey, tenantRateLimiter, requireAdmin);

/**
 * @openapi
 * /api/v1/tenants:
 *   post:
 *     summary: Create a new tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         description: Unique UUIDv4 to prevent duplicate creation on retries.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTenantPayload'
 *           example:
 *             name: "Acme Corp"
 *             plan: "PRO"
 *     responses:
 *       201:
 *         description: Tenant created.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Tenant'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient role — ADMIN required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Insufficient permissions."
 *               code: "INSUFFICIENT_PERMISSIONS"
 *       409:
 *         description: Duplicate Idempotency-Key — request already processed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Duplicate resource."
 *               code: "DUPLICATE_RESOURCE"
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.post('/', TenantController.create);

/**
 * @openapi
 * /api/v1/tenants:
 *   get:
 *     summary: List all tenants
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Tenant list.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Tenant'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.get('/', TenantController.list);

/**
 * @openapi
 * /api/v1/tenants/{id}:
 *   get:
 *     summary: Get tenant by ID
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     responses:
 *       200:
 *         description: Tenant found.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Tenant'
 *       404:
 *         description: Tenant not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.get('/:id', TenantController.getById);

/**
 * @openapi
 * /api/v1/tenants/{id}:
 *   patch:
 *     summary: Update tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTenantPayload'
 *           example:
 *             name: "Acme Corp (Renamed)"
 *             plan: "ENTERPRISE"
 *     responses:
 *       200:
 *         description: Tenant updated.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Tenant'
 *       403:
 *         description: Insufficient role — ADMIN required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Insufficient permissions."
 *               code: "INSUFFICIENT_PERMISSIONS"
 *       404:
 *         description: Tenant not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.patch('/:id', TenantController.update);

/**
 * @openapi
 * /api/v1/tenants/{id}/deactivate:
 *   post:
 *     summary: Deactivate a tenant
 *     description: Suspends the tenant — all their API keys become invalid immediately.
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     responses:
 *       200:
 *         description: Tenant deactivated.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Insufficient role — ADMIN required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Insufficient permissions."
 *               code: "INSUFFICIENT_PERMISSIONS"
 *       404:
 *         description: Tenant not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.post('/:id/deactivate', TenantController.deactivate);

/**
 * @openapi
 * /api/v1/tenants/{id}/reactivate:
 *   post:
 *     summary: Reactivate a tenant
 *     description: Restores a deactivated tenant. Their existing active API keys become valid again.
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     responses:
 *       200:
 *         description: Tenant reactivated.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Insufficient role — ADMIN required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Insufficient permissions."
 *               code: "INSUFFICIENT_PERMISSIONS"
 *       404:
 *         description: Tenant not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.post('/:id/reactivate', TenantController.reactivate);

/**
 * @openapi
 * /api/v1/tenants/{id}/usage:
 *   get:
 *     summary: Get tenant rate limit usage
 *     description: Returns current request counts against the tenant's per-minute and per-day limits.
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     responses:
 *       200:
 *         description: Tenant usage statistics.
 *         headers:
 *           X-RateLimit-Limit-Minute:
 *             $ref: '#/components/headers/XRateLimitLimitMinute'
 *           X-RateLimit-Remaining-Minute:
 *             $ref: '#/components/headers/XRateLimitRemainingMinute'
 *           X-RateLimit-Limit-Day:
 *             $ref: '#/components/headers/XRateLimitLimitDay'
 *           X-RateLimit-Remaining-Day:
 *             $ref: '#/components/headers/XRateLimitRemainingDay'
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         minuteUsage:
 *                           type: integer
 *                           example: 45
 *                         minuteLimit:
 *                           type: integer
 *                           example: 100
 *                         dayUsage:
 *                           type: integer
 *                           example: 3200
 *                         dayLimit:
 *                           type: integer
 *                           example: 10000
 *       404:
 *         description: Tenant not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Rate limit exceeded. Please wait before retrying."
 *               code: "RATE_LIMIT_EXCEEDED"
 */
router.get('/:id/usage', TenantController.getUsage);

export default router;
