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
import { createDocumentPaymentGate } from '../../middleware/documentPaymentGate';
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
 *     summary: Get the public profile of an asset
 *     description: |
 *       Public read endpoint for assets. Without an API key, returns the public-facing
 *       profile — suitable for QR code scans, NFC taps, or browser views.
 *
 *       With a valid API key belonging to the asset's tenant, returns the authenticated
 *       tenant view with additional fields. Keys from a different tenant receive 403.
 *     tags: [Public Assets]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *         description: Asset ID.
 *     responses:
 *       200:
 *         description: Asset returned.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Authenticated key belongs to a different tenant.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Asset not found.
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
 *     summary: Submit a blind contact message for an asset in alert state
 *     description: |
 *       Public contact endpoint for assets in `ALERT` state (e.g. lost/stolen items).
 *       Submitted data is stored as a blind contact log and forwarded to the asset
 *       owner via configured webhooks. No API key required.
 *     tags: [Public Assets]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *         description: Asset ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *           example:
 *             phone: "+5511999999999"
 *             message: "I found this item near Paulista Ave. Call me anytime."
 *     responses:
 *       201:
 *         description: Contact data recorded and forwarded to the asset owner.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Asset is not currently accepting contact requests.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Asset not found.
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
 *     summary: Verify a document by its SHA3-512 hash
 *     description: |
 *       Public endpoint (no authentication). Accepts a SHA3-512 hash of a document
 *       and returns a flat authenticity proof: asset, event, DLT anchoring, and
 *       confirmation status. This is the canonical public route for document
 *       verification — there is no alternative `/api/v1/verify/document/{hash}`.
 *
 *       The `blockchain` object is chain-agnostic and may include an explorer link
 *       when the chain has a supported mapping.
 *
 *       **The hash must be computed client-side** (e.g. WebCrypto API) — the file
 *       is never sent to the backend. The response intentionally omits `tenantId`,
 *       `metadata`, `owners`, `payload`, `signatureHash`, `sdmMacKey`, `writeKey`,
 *       and `apiKey` for privacy.
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
 *           example: "a3f9b2e1d4c7f8091011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859606162636465666768"
 *         description: SHA3-512 hash of the document (128 hex characters).
 *     responses:
 *       200:
 *         description: Document verified successfully.
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
 *                   format: uuid
 *                 assetStatus:
 *                   type: string
 *                   example: "ACTIVE"
 *                 publicUrl:
 *                   type: string
 *                   nullable: true
 *                 eventId:
 *                   type: string
 *                   format: uuid
 *                 dltTxId:
 *                   type: string
 *                   nullable: true
 *                 anchoredAt:
 *                   type: string
 *                   format: date-time
 *                 chain:
 *                   type: string
 *                   example: "STELLAR"
 *                 blockchain:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     dltTxId:
 *                       type: string
 *                       example: "4a8f2b1e9c3d7f60a5b2e8c1d4f7a0b3c6e9f2a5b8c1d4e7f0a3b6c9d2e5f8a1"
 *                     explorerUrl:
 *                       type: string
 *                       nullable: true
 *                       example: "https://stellar.expert/explorer/public/tx/4a8f2b1e9c3d7f60"
 *                     chain:
 *                       type: string
 *                       example: "STELLAR"
 *                     anchoredAt:
 *                       type: string
 *                       format: date-time
 *                 issuerId:
 *                   type: string
 *                   nullable: true
 *                 confirmationStatus:
 *                   type: string
 *                   example: "CONFIRMED"
 *             example:
 *               verified: true
 *               assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *               assetStatus: "ACTIVE"
 *               publicUrl: "https://app.quantumcert.com.br/public/verify/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *               dltTxId: "4a8f2b1e9c3d7f60a5b2e8c1d4f7a0b3c6e9f2a5b8c1d4e7f0a3b6c9d2e5f8a1"
 *               chain: "STELLAR"
 *               anchoredAt: "2026-05-13T22:00:00.000Z"
 *               blockchain:
 *                 dltTxId: "4a8f2b1e9c3d7f60a5b2e8c1d4f7a0b3c6e9f2a5b8c1d4e7f0a3b6c9d2e5f8a1"
 *                 explorerUrl: "https://stellar.expert/explorer/public/tx/4a8f2b1e9c3d7f60"
 *                 chain: "STELLAR"
 *                 anchoredAt: "2026-05-13T22:00:00.000Z"
 *               eventId: "e1f2a3b4-c5d6-7890-abcd-ef1234567890"
 *               issuerId: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *               confirmationStatus: "CONFIRMED"
 *       400:
 *         description: Invalid hash format — must be a 128-character SHA3-512 hex string.
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
 *                   example: "INVALID_DOCUMENT_HASH"
 *             example:
 *               success: false
 *               error: "Invalid document hash: must be a 128-character SHA3-512 hex string."
 *               code: "INVALID_DOCUMENT_HASH"
 *       404:
 *         description: No document found with this hash.
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
 *                   example: "DOCUMENT_NOT_FOUND"
 *             example:
 *               success: false
 *               error: "Document not found."
 *               code: "DOCUMENT_NOT_FOUND"
 *       501:
 *         description: Optional payment enabled but no provider configured.
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
 *                   example: "PAYMENT_PROVIDER_NOT_CONFIGURED"
 *             example:
 *               success: false
 *               error: "Document verification payment provider is not configured."
 *               code: "PAYMENT_PROVIDER_NOT_CONFIGURED"
 */
/**
 * @openapi
 * /api/v1/public/asset/{assetId}/contribution:
 *   post:
 *     summary: Submit a public contribution for an asset
 *     description: |
 *       Public contribution endpoint. The submitter must provide either `phone` or `email`.
 *       Registered auditors create an approved EventLog directly; other submitters create
 *       a PendingContribution that requires authenticated review via `POST /api/v1/contributions/{id}/review`.
 *
 *       Rate limited to 10 requests per 15 minutes per IP.
 *     tags: [Curation]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *         description: ID of the asset receiving the contribution.
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
 *                 example: "inspector@example.com"
 *               payload:
 *                 type: object
 *                 additionalProperties: true
 *             anyOf:
 *               - required: [phone]
 *               - required: [email]
 *           example:
 *             email: "inspector@example.com"
 *             payload:
 *               note: "Physical inspection completed. Serial number matches."
 *               location: "Warehouse B, Shelf 4"
 *     responses:
 *       201:
 *         description: Contribution accepted.
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
 *                       description: "`true` when an approved EventLog was created directly (auditor); `false` when pending review."
 *                     eventId:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                       example: "e1f2a3b4-c5d6-7890-abcd-ef1234567890"
 *                     pendingId:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                       example: "c7f3a1b2-d4e5-6789-abcd-ef0123456789"
 *       400:
 *         description: Invalid payload, phone, or email.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Asset not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       413:
 *         description: Payload too large.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Public contribution rate limit exceeded.
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
router.get('/verify/document/:hash', createDocumentPaymentGate(), async (req, res, next) => {
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
            blockchain: result.blockchain,
            eventId: result.eventId,
            issuerId: result.issuerId,
            confirmationStatus: result.confirmationStatus,
        });
    } catch (err) {
        next(err);
    }
});

export default router;
