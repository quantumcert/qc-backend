import { Router } from 'express';
import { TenantUserController } from '../../controllers/TenantUserController';
import { requireApiKey } from '../../middleware/apiKeyAuth';

const router = Router();

router.use(requireApiKey);

router.post('/quantum/ensure', TenantUserController.ensureQuantum);
router.get('/current', TenantUserController.current);
router.post('/current', TenantUserController.current);
router.post('/b2c/upsert', TenantUserController.upsertB2C);
router.patch('/:userId/profile', TenantUserController.updateProfile);
router.get('/:userId/dependents', TenantUserController.listDependents);
router.post('/:userId/dependents', TenantUserController.createDependent);
router.patch('/:userId/dependents/:dependentId', TenantUserController.updateDependent);
router.post('/:userId/external-identities', TenantUserController.linkExternalIdentity);

export default router;
