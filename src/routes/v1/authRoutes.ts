import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { TenantUserAuthController } from '../../controllers/TenantUserAuthController';

const router = Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
        success: false,
        error: 'Too many authentication attempts. Try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const ipKey = req.ip ? ipKeyGenerator(req.ip) : 'unknown-ip';
        const email = typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : 'no-email';
        return `${ipKey}:${email}`;
    },
});

const sessionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: {
        success: false,
        error: 'Too many session requests. Try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new tenant user
 *     description: |
 *       Creates a new user account scoped to a tenant. No API key required —
 *       authentication is session-based (cookie) after registration.
 *
 *       **Rate limit:** 20 requests per 15 minutes per IP + email combination.
 *       Exceeding this limit returns `429 Too Many Requests`.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@acmecorp.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "S3cur3P@ssword!"
 *               name:
 *                 type: string
 *                 example: "Jane Doe"
 *           example:
 *             email: "user@acmecorp.com"
 *             password: "S3cur3P@ssword!"
 *             name: "Jane Doe"
 *     responses:
 *       201:
 *         description: User registered. Session cookie set automatically.
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
 *                         id:
 *                           type: string
 *                           format: uuid
 *                           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *                         email:
 *                           type: string
 *                           example: "user@acmecorp.com"
 *                         name:
 *                           type: string
 *                           example: "Jane Doe"
 *       409:
 *         description: Email already in use.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded — 20 attempts per 15 minutes per IP + email.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register', authLimiter, TenantUserAuthController.register);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     summary: Log in with email and password
 *     description: |
 *       Authenticates a tenant user and sets a session cookie. No API key required.
 *
 *       **Rate limit:** 20 requests per 15 minutes per IP + email combination.
 *       This rate limit is applied **per email address**, meaning brute-force
 *       attempts against a single account from different IPs are also limited.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@acmecorp.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "S3cur3P@ssword!"
 *           example:
 *             email: "user@acmecorp.com"
 *             password: "S3cur3P@ssword!"
 *     responses:
 *       200:
 *         description: Login successful. Session cookie set.
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
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         email:
 *                           type: string
 *                         name:
 *                           type: string
 *       401:
 *         description: Invalid credentials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded — 20 attempts per 15 minutes per IP + email.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', authLimiter, TenantUserAuthController.login);

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     description: |
 *       Returns the profile of the currently authenticated user based on the
 *       active session cookie. No API key required — session-based auth only.
 *
 *       **Rate limit:** 120 requests per 15 minutes per IP.
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: Current user profile.
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
 *                         id:
 *                           type: string
 *                           format: uuid
 *                           example: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *                         email:
 *                           type: string
 *                           example: "user@acmecorp.com"
 *                         name:
 *                           type: string
 *                           example: "Jane Doe"
 *                         tenantId:
 *                           type: string
 *                           format: uuid
 *       401:
 *         description: No active session.
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
 */
router.get('/me', sessionLimiter, TenantUserAuthController.me);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     summary: Log out and invalidate session
 *     description: |
 *       Destroys the current session and clears the session cookie.
 *
 *       **Rate limit:** 120 requests per 15 minutes per IP.
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: Session invalidated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/logout', sessionLimiter, TenantUserAuthController.logout);

export default router;
