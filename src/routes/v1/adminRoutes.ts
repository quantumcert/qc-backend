// ═══════════════════════════════════════════════════════════
// ADMIN ROUTES — Internal use only.
// These routes are NOT included in the public OpenAPI spec
// (production). They appear in /api-docs only in development.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { AdminApiKeyController } from '../../controllers/AdminApiKeyController';
import { AdminCreditController } from '../../controllers/AdminCreditController';
import { AdminQTagController } from '../../controllers/AdminQTagController';
import { AdminTenantController } from '../../controllers/AdminTenantController';
import { TenantUserController } from '../../controllers/TenantUserController';
import { requireAdminReason, requirePlatformAdmin, requireTenantAdmin } from '../../middleware/platformAdminAuth';

const router = Router();

const ownTenantAdmin = requireTenantAdmin((req) => req.params.tenantId);

// ── Tenant-scoped self-service admin (requireTenantAdmin) ──────────────────

/**
 * @openapi
 * /api/v1/admin/tenant/{tenantId}:
 *   get:
 *     summary: Get own tenant details
 *     description: Returns full tenant record. Requires the caller to be an admin of the target tenant.
 *     tags: [Admin — Tenant Self-Service]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tenant record.
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
 *         description: Not an admin of this tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/tenant/:tenantId', ownTenantAdmin, AdminTenantController.get);

/**
 * @openapi
 * /api/v1/admin/tenant/{tenantId}/api-keys:
 *   get:
 *     summary: List API keys for own tenant
 *     tags: [Admin — Tenant Self-Service]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of API keys (raw values redacted).
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
 *                         $ref: '#/components/schemas/ApiKey'
 *       403:
 *         description: Not an admin of this tenant.
 */
router.get('/tenant/:tenantId/api-keys', ownTenantAdmin, AdminApiKeyController.list);

/**
 * @openapi
 * /api/v1/admin/tenant/{tenantId}/request-audit:
 *   get:
 *     summary: List API request audit log for own tenant
 *     description: Paginated log of all API requests made by keys belonging to this tenant.
 *     tags: [Admin — Tenant Self-Service]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Paginated audit entries.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Not an admin of this tenant.
 */
router.get('/tenant/:tenantId/request-audit', ownTenantAdmin, AdminApiKeyController.listRequestAudit);

/**
 * @openapi
 * /api/v1/admin/tenant/{tenantId}/credits/summary:
 *   get:
 *     summary: Get credit balance summary for own tenant
 *     tags: [Admin — Tenant Self-Service]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Credit summary (balance, daily usage, plan limits).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Not an admin of this tenant.
 */
router.get('/tenant/:tenantId/credits/summary', ownTenantAdmin, AdminCreditController.getCreditSummary);

/**
 * @openapi
 * /api/v1/admin/tenant/{tenantId}/purchase-orders:
 *   get:
 *     summary: List credit purchase orders for own tenant
 *     tags: [Admin — Tenant Self-Service]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Purchase order history.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/tenant/:tenantId/purchase-orders', ownTenantAdmin, AdminCreditController.listPurchaseOrders);

/**
 * @openapi
 * /api/v1/admin/tenant/{tenantId}/qtags/summary:
 *   get:
 *     summary: Get QTAG allocation summary for own tenant
 *     tags: [Admin — Tenant Self-Service]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: QTAG balance, used, reserved counts.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/tenant/:tenantId/qtags/summary', ownTenantAdmin, AdminQTagController.getSummary);

router.use(requirePlatformAdmin);

// ── Platform admin (requirePlatformAdmin) ──────────────────────────────────

/**
 * @openapi
 * /api/v1/admin/platform/tenants:
 *   get:
 *     summary: List all tenants (platform admin)
 *     description: Returns every tenant in the system. Requires platform admin credentials.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Array of all tenants.
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
 *       403:
 *         description: Platform admin credentials required.
 *   post:
 *     summary: Create a tenant (platform admin)
 *     description: Provisions a new tenant. Requires `X-Admin-Reason` header describing the justification.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *         description: Reason for the operation — written to the audit log.
 *         example: "Onboarding partner Acme Corp per contract #2026-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTenantPayload'
 *     responses:
 *       201:
 *         description: Tenant created.
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
 *         description: Platform admin credentials required or missing X-Admin-Reason.
 */
router.get('/platform/tenants', AdminTenantController.list);
router.post('/platform/tenants', requireAdminReason, AdminTenantController.create);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}:
 *   get:
 *     summary: Get any tenant by ID (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tenant record.
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
 */
router.get('/platform/tenants/:tenantId', AdminTenantController.get);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/users:
 *   get:
 *     summary: List users of any tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User list.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   post:
 *     summary: Create a user in any tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, role]
 *             properties:
 *               email: { type: string, format: email, example: "ops@acmecorp.com" }
 *               name: { type: string, example: "Operations Bot" }
 *               role: { type: string, enum: [ADMIN, OPERATOR, READER], example: "OPERATOR" }
 *           example:
 *             email: "ops@acmecorp.com"
 *             name: "Operations Bot"
 *             role: "OPERATOR"
 *     responses:
 *       201:
 *         description: User created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/platform/tenants/:tenantId/users', TenantUserController.adminList);
router.post('/platform/tenants/:tenantId/users', requireAdminReason, TenantUserController.adminCreate);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/users/{userId}:
 *   get:
 *     summary: Get a specific user (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *   patch:
 *     summary: Update a user (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: "Jane Doe (Updated)" }
 *     responses:
 *       200:
 *         description: User updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/platform/tenants/:tenantId/users/:userId', TenantUserController.adminGet);
router.patch('/platform/tenants/:tenantId/users/:userId', requireAdminReason, TenantUserController.adminUpdate);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/users/{userId}/status:
 *   post:
 *     summary: Change user status (platform admin)
 *     description: Activates or suspends a user account. Requires `X-Admin-Reason`.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACTIVE, SUSPENDED], example: "SUSPENDED" }
 *           example:
 *             status: "SUSPENDED"
 *     responses:
 *       200:
 *         description: Status updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post('/platform/tenants/:tenantId/users/:userId/status', requireAdminReason, TenantUserController.adminStatus);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/users/{userId}/role:
 *   post:
 *     summary: Change user role (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [ADMIN, OPERATOR, READER], example: "ADMIN" }
 *           example:
 *             role: "ADMIN"
 *     responses:
 *       200:
 *         description: Role updated.
 */
router.post('/platform/tenants/:tenantId/users/:userId/role', requireAdminReason, TenantUserController.adminRole);
router.get('/platform/tenants/:tenantId/users/:userId/assets', TenantUserController.adminAssets);
router.get('/platform/tenants/:tenantId/users/:userId/profile-asset', TenantUserController.adminProfileAsset);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/profile:
 *   patch:
 *     summary: Update commercial profile (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Commercial profile fields (CNPJ, trading name, address, etc.)
 *     responses:
 *       200:
 *         description: Profile updated.
 */
router.patch('/platform/tenants/:tenantId/profile', requireAdminReason, AdminTenantController.updateCommercialProfile);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/review:
 *   post:
 *     summary: Submit tenant for KYB review (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Submitted for review.
 */
router.post('/platform/tenants/:tenantId/review', requireAdminReason, AdminTenantController.submitForReview);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/activate:
 *   post:
 *     summary: Activate a tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tenant activated.
 */
router.post('/platform/tenants/:tenantId/activate', requireAdminReason, AdminTenantController.activate);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/suspend:
 *   post:
 *     summary: Suspend a tenant (platform admin)
 *     description: Suspends all operations for this tenant. All API keys stop working immediately.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tenant suspended.
 */
router.post('/platform/tenants/:tenantId/suspend', requireAdminReason, AdminTenantController.suspend);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/archive:
 *   post:
 *     summary: Archive a tenant (platform admin)
 *     description: Permanently archives the tenant. Irreversible outside of a manual database operation.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tenant archived.
 */
router.post('/platform/tenants/:tenantId/archive', requireAdminReason, AdminTenantController.archive);

router.get('/platform/tenants/:tenantId/request-audit', AdminApiKeyController.listRequestAudit);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/credits/summary:
 *   get:
 *     summary: Get credit summary for any tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Credit balance, daily usage and plan limits.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/platform/tenants/:tenantId/credits/summary', AdminCreditController.getCreditSummary);
router.get('/platform/tenants/:tenantId/credits/ledger', AdminCreditController.listCreditLedger);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/credits/grants:
 *   post:
 *     summary: Grant credits to a tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: integer, example: 1000 }
 *               note: { type: string, example: "Promotional grant — onboarding" }
 *           example:
 *             amount: 1000
 *             note: "Promotional grant — onboarding"
 *     responses:
 *       200:
 *         description: Credits granted.
 */
router.post('/platform/tenants/:tenantId/credits/grants', requireAdminReason, AdminCreditController.grantCredits);
router.post('/platform/tenants/:tenantId/credits/adjustments', requireAdminReason, AdminCreditController.adjustCredits);
router.post('/platform/tenants/:tenantId/credits/revocations', requireAdminReason, AdminCreditController.revokeCredits);
router.post('/platform/tenants/:tenantId/credit-purchases', requireAdminReason, AdminCreditController.createCreditPurchaseIntent);
router.get('/platform/tenants/:tenantId/purchase-orders', AdminCreditController.listPurchaseOrders);
router.get('/platform/payments/events', AdminCreditController.listPaymentEvents);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/qtags/summary:
 *   get:
 *     summary: Get QTAG summary for any tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: QTAG balance, used and reserved counts.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/platform/tenants/:tenantId/qtags/summary', AdminQTagController.getSummary);
router.get('/platform/tenants/:tenantId/qtags/ledger', AdminQTagController.listLedger);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/qtags/grants:
 *   post:
 *     summary: Grant QTAGs to a tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, example: 500 }
 *               note: { type: string, example: "Pilot batch — São Paulo rollout" }
 *           example:
 *             quantity: 500
 *             note: "Pilot batch — São Paulo rollout"
 *     responses:
 *       200:
 *         description: QTAGs granted.
 */
router.post('/platform/tenants/:tenantId/qtags/grants', requireAdminReason, AdminQTagController.grant);
router.post('/platform/tenants/:tenantId/qtags/reservations', requireAdminReason, AdminQTagController.reserve);
router.post('/platform/tenants/:tenantId/qtags/fulfillment/:orderId/release', requireAdminReason, AdminQTagController.release);
router.post('/platform/tenants/:tenantId/qtags/fulfillment/:orderId/status', requireAdminReason, AdminQTagController.transitionStatus);
router.get('/platform/qtags/fulfillment', AdminQTagController.listQueue);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/api-keys:
 *   get:
 *     summary: List API keys for any tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of API keys (raw values redacted).
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
 *                         $ref: '#/components/schemas/ApiKey'
 *   post:
 *     summary: Create an API key for any tenant (platform admin)
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateApiKeyPayload'
 *     responses:
 *       201:
 *         description: API key created. Raw value shown once.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get('/platform/tenants/:tenantId/api-keys', AdminApiKeyController.list);
router.post('/platform/tenants/:tenantId/api-keys', requireAdminReason, AdminApiKeyController.create);
router.post('/platform/tenants/:tenantId/api-keys/initial', requireAdminReason, AdminApiKeyController.createInitial);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/api-keys/{apiKeyId}/rotate:
 *   post:
 *     summary: Rotate an API key (platform admin)
 *     description: |
 *       Issues a new raw key value for the given API key ID and invalidates the old value.
 *       The new raw value is returned once. Requires `X-Admin-Reason`.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: apiKeyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Key rotated. New raw value shown once.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post('/platform/tenants/:tenantId/api-keys/:apiKeyId/rotate', requireAdminReason, AdminApiKeyController.rotate);

/**
 * @openapi
 * /api/v1/admin/platform/tenants/{tenantId}/api-keys/{apiKeyId}/revoke:
 *   post:
 *     summary: Revoke an API key (platform admin)
 *     description: Permanently deactivates the key. Cannot be undone — a new key must be issued.
 *     tags: [Admin — Platform]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: apiKeyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-Admin-Reason
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Key revoked.
 */
router.post('/platform/tenants/:tenantId/api-keys/:apiKeyId/revoke', requireAdminReason, AdminApiKeyController.revoke);

export default router;
