// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 3: Public Profile & Privacy Control
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ContextRouterController } from '../../controllers/ContextRouterController';
import { BlindContactController } from '../../controllers/BlindContactController';
import { DocumentVerificationFacet } from '../../services/core-facets/DocumentVerificationFacet';
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
// Sub-sistema 3: Zero-Knowledge Document Verification
router.get('/verify/document/:hash', async (req, res, next) => {
    try {
        const hash = req.params.hash;
        const result = await DocumentVerificationFacet.verifyByHash(hash);

        if (!result.valid) {
            return res.status(404).json({ valid: false, asset: null });
        }

        return res.status(200).json({ valid: true, asset: result.asset });
    } catch (err) {
        next(err);
    }
});


export default router;
