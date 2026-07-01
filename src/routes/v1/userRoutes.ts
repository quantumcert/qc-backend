import { Router } from 'express';
import { TenantUserController } from '../../controllers/TenantUserController';
import { requireApiKey } from '../../middleware/apiKeyAuth';

const router = Router();

router.use(requireApiKey);

/**
 * @openapi
 * /api/v1/users/quantum/ensure:
 *   post:
 *     summary: Ensure the Quantum platform user exists for a tenant
 *     description: |
 *       Idempotent operation that creates the canonical Quantum platform user
 *       for the authenticated tenant if it does not already exist. Safe to
 *       call multiple times — returns the existing user if already provisioned.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Quantum user ensured (created or already existed).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/quantum/ensure', TenantUserController.ensureQuantum);

/**
 * @openapi
 * /api/v1/users/current:
 *   get:
 *     summary: Get the current tenant user
 *     description: Returns the user record associated with the authenticated API key's tenant context.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current user record.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/current', TenantUserController.current);
router.post('/current', TenantUserController.current);

/**
 * @openapi
 * /api/v1/users/b2c/upsert:
 *   post:
 *     summary: Upsert a B2C user
 *     description: |
 *       Creates or updates a B2C (consumer-facing) user record scoped to the
 *       authenticated tenant. Used by consumer apps to sync user identity.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               externalId:
 *                 type: string
 *                 description: User ID from the external identity provider.
 *                 example: "auth0|6123456789abcdef01234567"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "consumer@example.com"
 *               name:
 *                 type: string
 *                 example: "John Consumer"
 *           example:
 *             externalId: "auth0|6123456789abcdef01234567"
 *             email: "consumer@example.com"
 *             name: "John Consumer"
 *     responses:
 *       200:
 *         description: User upserted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/b2c/upsert', TenantUserController.upsertB2C);

/**
 * @openapi
 * /api/v1/users/{userId}/profile:
 *   patch:
 *     summary: Update a user's profile
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Jane Doe (Updated)"
 *               phone:
 *                 type: string
 *                 example: "+5511999999999"
 *               avatarUrl:
 *                 type: string
 *                 format: uri
 *                 example: "https://cdn.example.com/avatars/jane.jpg"
 *           example:
 *             name: "Jane Doe (Updated)"
 *             phone: "+5511999999999"
 *     responses:
 *       200:
 *         description: Profile updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:userId/profile', TenantUserController.updateProfile);

/**
 * @openapi
 * /api/v1/users/{userId}/dependents:
 *   get:
 *     summary: List dependents of a user
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     responses:
 *       200:
 *         description: List of dependents.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:userId/dependents', TenantUserController.listDependents);

/**
 * @openapi
 * /api/v1/users/{userId}/registration-credit/summary:
 *   get:
 *     summary: Get registration credit summary for a user
 *     description: Returns the current registration credit balance and usage history for the user.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     responses:
 *       200:
 *         description: Credit summary.
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
 *                         balance:
 *                           type: integer
 *                           example: 5
 *                         totalGranted:
 *                           type: integer
 *                           example: 10
 *                         totalConsumed:
 *                           type: integer
 *                           example: 5
 */
router.get('/:userId/registration-credit/summary', TenantUserController.registrationCreditSummary);

/**
 * @openapi
 * /api/v1/users/{userId}/registration-credit/asset-consumption:
 *   post:
 *     summary: Consume a registration credit for asset creation
 *     description: Deducts one registration credit from the user's balance to cover an asset registration fee.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assetId]
 *             properties:
 *               assetId:
 *                 type: string
 *                 format: uuid
 *                 example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *           example:
 *             assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: Credit consumed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       402:
 *         description: Insufficient registration credits.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:userId/registration-credit/asset-consumption', TenantUserController.consumeAssetRegistrationCredit);

/**
 * @openapi
 * /api/v1/users/{userId}/dependents:
 *   post:
 *     summary: Create a dependent for a user
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Child Name"
 *               document:
 *                 type: string
 *                 example: "123.456.789-01"
 *           example:
 *             name: "Child Name"
 *             document: "123.456.789-01"
 *     responses:
 *       201:
 *         description: Dependent created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post('/:userId/dependents', TenantUserController.createDependent);

/**
 * @openapi
 * /api/v1/users/{userId}/dependents/registration-credit:
 *   post:
 *     summary: Create a dependent using a registration credit
 *     description: Creates a dependent and simultaneously consumes one registration credit to cover the associated asset registration.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Child Name"
 *               document:
 *                 type: string
 *                 example: "123.456.789-01"
 *           example:
 *             name: "Child Name"
 *             document: "123.456.789-01"
 *     responses:
 *       201:
 *         description: Dependent created and credit consumed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       402:
 *         description: Insufficient registration credits.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:userId/dependents/registration-credit', TenantUserController.createDependentWithRegistrationCredit);

/**
 * @openapi
 * /api/v1/users/{userId}/dependents/{dependentId}:
 *   patch:
 *     summary: Update a dependent
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *       - in: path
 *         name: dependentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "c7f3a1b2-d4e5-6789-abcd-ef0123456789"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Child Name (Updated)"
 *           example:
 *             name: "Child Name (Updated)"
 *     responses:
 *       200:
 *         description: Dependent updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Dependent not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:userId/dependents/:dependentId', TenantUserController.updateDependent);

/**
 * @openapi
 * /api/v1/users/{userId}/external-identities:
 *   post:
 *     summary: Link an external identity to a user
 *     description: |
 *       Associates an external identity provider record (e.g. OAuth, SSO) with an
 *       existing tenant user. Used to bridge external auth systems with the platform.
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, externalId]
 *             properties:
 *               provider:
 *                 type: string
 *                 example: "auth0"
 *               externalId:
 *                 type: string
 *                 example: "auth0|6123456789abcdef01234567"
 *           example:
 *             provider: "auth0"
 *             externalId: "auth0|6123456789abcdef01234567"
 *     responses:
 *       201:
 *         description: External identity linked.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: External identity already linked to another user.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:userId/external-identities', TenantUserController.linkExternalIdentity);

export default router;
