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

/**
 * @openapi
 * /api/v1/public/asset/{id}:
 *   get:
 *     summary: Ler perfil público de um ativo
 *     description: |
 *       Endpoint público de leitura de ativo. Sem API key, retorna o perfil público
 *       filtrado para leituras via QR, NFC ou navegador. Com uma API key válida,
 *       pode retornar a visão autenticada do tenant quando a chave pertence ao
 *       tenant do ativo.
 *     tags: [Public Assets]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do ativo.
 *     responses:
 *       200:
 *         description: Ativo retornado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: A chave autenticada pertence a outro tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ativo não encontrado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/asset/:id', optionalApiKey, ContextRouterController.getAsset);

/**
 * @openapi
 * /api/v1/public/asset/{id}/contact:
 *   post:
 *     summary: Enviar contato blindado para um ativo em alerta
 *     description: |
 *       Endpoint público de contato para ativos em estado ALERT. Os dados enviados
 *       são armazenados como blind contact log e repassados ao owner do ativo pelos
 *       webhooks configurados. Não exige API key.
 *     tags: [Public Assets]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do ativo.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *             example:
 *               phone: "+5511999999999"
 *               message: "I found this item."
 *     responses:
 *       201:
 *         description: Dados de contato registrados e repassados.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: O ativo não está aceitando solicitações de contato.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ativo não encontrado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/asset/:id/contact', BlindContactController.submitContact);

/**
 * @openapi
 * /api/v1/public/verify/document/{hash}:
 *   get:
 *     summary: Verificar documento por hash SHA3-512
 *     description: |
 *       Endpoint público (sem autenticação). Recebe o hash SHA3-512 de um documento
 *       e retorna uma prova pública flat de autenticidade: asset, evento, ancoragem DLT
 *       e status de confirmação. Esta é a rota pública canônica para verificação documental; não existe
 *       rota alternativa `/api/v1/verify/document/{hash}`.
 *
 *       O hash deve ser calculado **client-side** (WebCrypto API) — o arquivo nunca
 *       é enviado ao backend. A resposta de sucesso não expõe `tenantId`, `metadata`,
 *       `owners`, `payload`, `signatureHash`, `sdmMacKey`, `writeKey` ou `apiKey`.
 *     tags: [Document Verification]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: hash
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 128
 *           maxLength: 128
 *           pattern: '^[0-9A-Fa-f]{128}$'
 *           example: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
 *             example:
 *               verified: true
 *               assetId: "uuid-do-ativo"
 *               assetStatus: "ACTIVE"
 *               publicUrl: "https://api.domain.com/v1/public/asset/uuid-do-ativo"
 *               dltTxId: "ALGOTX123"
 *               chain: "ALGORAND"
 *               anchoredAt: "2026-05-13T22:00:00.000Z"
 *               eventId: "event-id"
 *               issuerId: "api-key-id"
 *               confirmationStatus: "CONFIRMED"
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
 *             example:
 *               success: false
 *               error: "Invalid document hash: must be a 128-character SHA3-512 hex string."
 *               code: "INVALID_DOCUMENT_HASH"
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
 *             example:
 *               success: false
 *               error: "Document not found."
 *               code: "DOCUMENT_NOT_FOUND"
 */
/**
 * @openapi
 * /api/v1/public/asset/{assetId}/contribution:
 *   post:
 *     summary: Enviar contribuição pública para um ativo
 *     description: |
 *       Endpoint público de contribuição. O solicitante deve informar `phone` ou
 *       `email`. Auditores registrados podem criar um EventLog aprovado diretamente;
 *       outros solicitantes criam uma PendingContribution para revisão autenticada.
 *     tags: [Curation]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do ativo que recebe a contribuição.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+5511999999999"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "auditor@example.com"
 *               payload:
 *                 type: object
 *                 additionalProperties: true
 *                 example:
 *                   note: "Inspection note"
 *             anyOf:
 *               - required: [phone]
 *               - required: [email]
 *     responses:
 *       201:
 *         description: Contribuição aceita.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     queued:
 *                       type: boolean
 *                       description: True quando um EventLog aprovado foi criado diretamente; false quando a revisão está pendente.
 *                     eventId:
 *                       type: string
 *                       nullable: true
 *                     pendingId:
 *                       type: string
 *                       nullable: true
 *       400:
 *         description: Payload, telefone ou e-mail inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ativo não encontrado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       413:
 *         description: Payload muito grande.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit de contribuição pública excedido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
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
