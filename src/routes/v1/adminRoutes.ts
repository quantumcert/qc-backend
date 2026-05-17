import { Router } from 'express';
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

export default router;
