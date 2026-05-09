// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 3: Public Profile & Privacy Control
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ContextRouterController } from '../../controllers/ContextRouterController';
import { BlindContactController } from '../../controllers/BlindContactController';
import { DocumentVerificationFacet } from '../../services/core-facets/DocumentVerificationFacet';
import { CurationFacet } from '../../services/core-facets/CurationFacet';
import { optionalApiKey } from '../../middleware/apiKeyAuth';

const router = Router();

// Phase 3: Context Routing (Authenticated / Public)
router.get('/asset/:id', optionalApiKey, ContextRouterController.getAsset);

// Phase 5: Double-Blind Quarantine (Finder's Contact Form for ALERT Assets)
router.post('/asset/:id/contact', BlindContactController.submitContact);

/**
 * @openapi
 * /api/v1/public/verify/document/{hash}:
 *   get:
 *     summary: Verificar documento por hash SHA3-512
 *     description: |
 *       Endpoint público (sem autenticação). Recebe o hash SHA3-512 de um documento
 *       e retorna a prova matemática de autenticidade: o EventLog que selou o documento
 *       na blockchain, incluindo o `dltTxId` e a assinatura Falcon-512.
 *
 *       O hash deve ser calculado **client-side** (WebCrypto API) — o arquivo nunca
 *       é enviado ao backend.
 *     tags: [Document Verification]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: hash
 *         required: true
 *         schema:
 *           type: string
 *           example: a3f1b2c4d5e6...
 *         description: Hash SHA3-512 do documento (128 caracteres hex)
 *     responses:
 *       200:
 *         description: Documento verificado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified:
 *                   type: boolean
 *                   example: true
 *                 assetId:
 *                   type: string
 *                 eventId:
 *                   type: string
 *                 dltTxId:
 *                   type: string
 *                 anchoredAt:
 *                   type: string
 *                   format: date-time
 *                 chain:
 *                   type: string
 *                   example: ALGORAND
 *       400:
 *         description: Formato de hash inválido (não é SHA3-512 hex de 128 chars)
 *       404:
 *         description: Nenhum documento encontrado com este hash
 */
// Curation Layer — CORE-05: Public contribution submission (no API key required)
// POST /api/v1/public/asset/:assetId/contribution
router.post('/asset/:assetId/contribution', async (req, res, next) => {
    try {
        const { assetId } = req.params;
        const { phone, email, payload } = req.body;
        const result = await CurationFacet.submitContribution({
            assetId,
            phone,
            email,
            payload: payload ?? {},
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err: any) {
        if (err.httpStatus) {
            return res.status(err.httpStatus).json({
                success: false,
                error: err.message,
                code: err.code,
            });
        }
        next(err);
    }
});

// Sub-sistema 3: Zero-Knowledge Document Verification
router.get('/verify/document/:hash', async (req, res, next) => {
    try {
        const hash = req.params.hash;
        const result = await DocumentVerificationFacet.verifyByHash(hash);

        if (!result.verified) {
            return res.status(404).json({ verified: false, reason: result.reason ?? null });
        }

        return res.status(200).json({
            verified: true,
            assetId: result.assetId,
            assetStatus: result.assetStatus,
            dltTxId: result.dltTxId,
            anchoredAt: result.anchoredAt,
            eventId: result.eventId,
            issuerId: result.issuerId,
        });
    } catch (err) {
        next(err);
    }
});


export default router;
