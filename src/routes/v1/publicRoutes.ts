// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 3: Public Profile & Privacy Control
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ContextRouterController } from '../../controllers/ContextRouterController';
import { BlindContactController } from '../../controllers/BlindContactController';
import { optionalApiKey } from '../../middleware/apiKeyAuth';

const router = Router();

// Phase 3: Context Routing (Authenticated / Public)
router.get('/asset/:id', optionalApiKey, ContextRouterController.getAsset);

// Phase 5: Double-Blind Quarantine (Finder's Contact Form for ALERT Assets)
router.post('/asset/:id/contact', BlindContactController.submitContact);

export default router;
