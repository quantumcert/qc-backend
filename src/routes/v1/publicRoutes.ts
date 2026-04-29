// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 3: Public Profile & Privacy Control
// ═══════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { ContextRouterController } from '../../controllers/ContextRouterController';
import { BlindContactController } from '../../controllers/BlindContactController';
import { DocumentVerificationFacet } from '../../services/core-facets/DocumentVerificationFacet';
import { SDMVerifierService } from '../../services/SDMVerifierService';
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

router.get('/scan', async (req: Request, res: Response) => {
  const { p, m, lat, lon, uid } = req.query as Record<string, string>;

  if (!p || !m) {
    return res.status(400).json({ error: 'Missing required parameters: p, m' });
  }

  try {
    const result = await SDMVerifierService.verifyTap({
      piccDataHex: p,
      cmacHex: m,
      lat: lat ? parseFloat(lat) : null,
      lon: lon ? parseFloat(lon) : null,
      ip: req.ip ?? '0.0.0.0',
      uidHex: uid ?? undefined,
    });

    const httpStatus = result.status === 'APPROVED' ? 200 : 403;
    return res.status(httpStatus).json(result);
  } catch (err: any) {
    if (err.message === 'INVALID_INPUT') {
      return res.status(400).json({ error: 'Invalid NFC parameters.' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
