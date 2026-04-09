// ═══════════════════════════════════════════════════════════
// DEVICE ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Zero Knowledge Security
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { DeviceController } from '../../controllers/DeviceController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

import rateLimit from 'express-rate-limit';

const router = Router();

// 🔴 RED TEAM FIX: NFC Brute-Force Guardian
const nfcValidateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 5, // Limit each IP to 5 requests per windowMs
    message: { success: false, error: 'Too many NFC validation attempts from this IP, please try again after a minute' },
    standardHeaders: true,
    legacyHeaders: false
});

// Device Registration (ADMIN only)
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireAdmin, DeviceController.register);

// NFC Tap Validation (Public or Authenticated)
// Using optionalApiKey to support both API-based validation and public URL validation
router.get('/tap', nfcValidateLimiter, optionalApiKey, tenantRateLimiter, DeviceController.validateTap);

export default router;
