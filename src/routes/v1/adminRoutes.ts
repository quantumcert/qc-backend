import { Router } from 'express';
import { AdminApiKeyController } from '../../controllers/AdminApiKeyController';
import { AdminTenantController } from '../../controllers/AdminTenantController';
import { requireAdminReason, requirePlatformAdmin } from '../../middleware/platformAdminAuth';

const router = Router();

router.use(requirePlatformAdmin);

router.get('/platform/tenants', AdminTenantController.list);
router.post('/platform/tenants', requireAdminReason, AdminTenantController.create);
router.get('/platform/tenants/:tenantId', AdminTenantController.get);
router.patch(
    '/platform/tenants/:tenantId/profile',
    requireAdminReason,
    AdminTenantController.updateCommercialProfile
);
router.post(
    '/platform/tenants/:tenantId/review',
    requireAdminReason,
    AdminTenantController.submitForReview
);
router.post(
    '/platform/tenants/:tenantId/activate',
    requireAdminReason,
    AdminTenantController.activate
);
router.post(
    '/platform/tenants/:tenantId/suspend',
    requireAdminReason,
    AdminTenantController.suspend
);
router.post(
    '/platform/tenants/:tenantId/archive',
    requireAdminReason,
    AdminTenantController.archive
);
router.get(
    '/platform/tenants/:tenantId/request-audit',
    AdminApiKeyController.listRequestAudit
);
router.get(
    '/platform/tenants/:tenantId/api-keys',
    AdminApiKeyController.list
);
router.post(
    '/platform/tenants/:tenantId/api-keys/initial',
    requireAdminReason,
    AdminApiKeyController.createInitial
);
router.post(
    '/platform/tenants/:tenantId/api-keys/:apiKeyId/rotate',
    requireAdminReason,
    AdminApiKeyController.rotate
);
router.post(
    '/platform/tenants/:tenantId/api-keys/:apiKeyId/revoke',
    requireAdminReason,
    AdminApiKeyController.revoke
);

export default router;
