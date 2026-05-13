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
import rateLimit from 'express-rate-limit';

const router = Router();

const publicContributionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        error: 'Too many contribution submissions from this IP. Try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

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
 *                 assetStatus:
 *                   type: string
 *                 publicUrl:
 *                   type: string
 *                   nullable: true
 *                 eventId:
 *                   type: string
 *                 dltTxId:
 *                   type: string
 *                   nullable: true
 *                 anchoredAt:
 *                   type: string
 *                   format: date-time
 *                 chain:
 *                   type: string
 *                   example: ALGORAND
 *                 issuerId:
 *                   type: string
 *                   nullable: true
 *                 confirmationStatus:
 *                   type: string
 *                   example: CONFIRMED
 *       400:
 *         description: Formato de hash inválido (não é SHA3-512 hex de 128 chars)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   example: INVALID_DOCUMENT_HASH
 *       404:
 *         description: Nenhum documento encontrado com este hash
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   example: DOCUMENT_NOT_FOUND
 */
// Curation Layer — CORE-05: Public contribution submission (no API key required)
// POST /api/v1/public/asset/:assetId/contribution
router.post('/asset/:assetId/contribution', publicContributionLimiter, async (req, res, next) => {
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
            if (result.reason === 'INVALID_DOCUMENT_HASH') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid document hash: must be a 128-character SHA3-512 hex string.',
                    code: 'INVALID_DOCUMENT_HASH',
                });
            }

            return res.status(404).json({
                success: false,
                error: 'Document not found.',
                code: 'DOCUMENT_NOT_FOUND',
            });
        }

        return res.status(200).json({
            verified: true,
            assetId: result.assetId,
            assetStatus: result.assetStatus,
            publicUrl: result.publicUrl,
            dltTxId: result.dltTxId,
            chain: result.chain,
            anchoredAt: result.anchoredAt,
            eventId: result.eventId,
            issuerId: result.issuerId,
            confirmationStatus: result.confirmationStatus,
        });
    } catch (err) {
        next(err);
    }
});


export default router;
