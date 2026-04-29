// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 3: Public Profile & Privacy Control
// ═══════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { ContextRouterController } from '../../controllers/ContextRouterController';
import { BlindContactController } from '../../controllers/BlindContactController';
import { DocumentVerificationFacet } from '../../services/core-facets/DocumentVerificationFacet';
import { optionalApiKey } from '../../middleware/apiKeyAuth';

const router = Router();

// Phase 3: Context Routing (Authenticated / Public)
router.get('/asset/:id', optionalApiKey, ContextRouterController.getAsset);

// Phase 5: Double-Blind Quarantine (Finder's Contact Form for ALERT Assets)
router.post('/asset/:id/contact', BlindContactController.submitContact);

// Sub-sistema 3: Zero-Knowledge Document Verification
router.get('/verify/document/:hash', async (req, res, next) => {
    try {
        const result = await DocumentVerificationFacet.verifyByHash(req.params.hash);
        const statusCode = result.verified ? 200 : (result.reason === 'Invalid hash format' ? 400 : 404);
        res.status(statusCode).json(result);
    } catch (err) {
        next(err);
    }
});

export default router;
