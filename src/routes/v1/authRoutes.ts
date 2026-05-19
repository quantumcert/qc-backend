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

router.post('/register', authLimiter, TenantUserAuthController.register);
router.post('/login', authLimiter, TenantUserAuthController.login);
router.get('/me', sessionLimiter, TenantUserAuthController.me);
router.post('/logout', sessionLimiter, TenantUserAuthController.logout);

export default router;
