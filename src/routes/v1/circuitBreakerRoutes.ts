// ============================================================
// CIRCUIT BREAKER ROUTES
// Post-Quantum Institutional Grade Emergency Pause
//
// Protected by: Admin API Key + Falcon-512 Signature
// ============================================================

import { Router } from 'express';
import { CircuitBreakerService } from '../../services/CircuitBreakerService';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

/**
 * @openapi
 * /api/v1/circuit-breaker/status:
 *   get:
 *     summary: Get circuit breaker status for all chains
 *     description: Returns the current pause state of every supported blockchain.
 *     tags: [Circuit Breaker]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current status of all chains.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           chain:
 *                             type: string
 *                             example: "ETHEREUM"
 *                           paused:
 *                             type: boolean
 *                             example: false
 *                           pausedAt:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                           reason:
 *                             type: string
 *                             nullable: true
 *             example:
 *               success: true
 *               data:
 *                 ETHEREUM:
 *                   chain: "ETHEREUM"
 *                   paused: false
 *                   pausedAt: null
 *                   reason: null
 *                 POLYGON:
 *                   chain: "POLYGON"
 *                   paused: true
 *                   pausedAt: "2026-06-30T20:15:00.000Z"
 *                   reason: "Anomaly detected by SecurityWatchdogService"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/status', requireApiKey, tenantRateLimiter, async (req, res) => {
    try {
        const service = CircuitBreakerService.getInstance();
        const statuses = service.getAllStatuses();
        res.json({ success: true, data: statuses });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @openapi
 * /api/v1/circuit-breaker/pause:
 *   post:
 *     summary: Pause a specific chain
 *     description: |
 *       Emergency pause for a single blockchain. All operations on the paused chain
 *       are rejected until `resume` is called. Requires ADMIN role and a valid
 *       Falcon-512 signature in the `X-Quantum-Signature` header.
 *     tags: [Circuit Breaker]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chain, signature]
 *             properties:
 *               chain:
 *                 type: string
 *                 enum: [ETHEREUM, POLYGON, SOLANA, STELLAR, ALGORAND]
 *                 example: "POLYGON"
 *               signature:
 *                 type: string
 *                 description: Falcon-512 admin signature (base64-encoded).
 *                 example: "FALC512_BASE64_SIGNATURE_HERE..."
 *               reason:
 *                 type: string
 *                 example: "Suspicious transaction volume spike detected."
 *           example:
 *             chain: "POLYGON"
 *             signature: "FALC512_BASE64_SIGNATURE_HERE..."
 *             reason: "Suspicious transaction volume spike detected."
 *     responses:
 *       200:
 *         description: Chain paused successfully.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         chain:
 *                           type: string
 *                           example: "POLYGON"
 *                         paused:
 *                           type: boolean
 *                           example: true
 *                         pausedAt:
 *                           type: string
 *                           format: date-time
 *       400:
 *         description: Missing required fields.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient role — ADMIN required, or invalid Falcon-512 signature.
 */
router.post('/pause', requireApiKey, tenantRateLimiter, requireAdmin, async (req, res) => {
    try {
        const { chain, signature } = req.body;
        if (!chain || !signature) {
            return res.status(400).json({ success: false, error: 'chain and signature required' });
        }

        const service = CircuitBreakerService.getInstance();
        const result = await service.pauseChain(chain as any, signature);

        res.json({ success: true, data: result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @openapi
 * /api/v1/circuit-breaker/resume:
 *   post:
 *     summary: Resume a paused chain
 *     description: |
 *       Resumes operations on a previously paused blockchain. Requires ADMIN role
 *       and a valid Falcon-512 signature.
 *     tags: [Circuit Breaker]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chain, signature]
 *             properties:
 *               chain:
 *                 type: string
 *                 enum: [ETHEREUM, POLYGON, SOLANA, STELLAR, ALGORAND]
 *                 example: "POLYGON"
 *               signature:
 *                 type: string
 *                 description: Falcon-512 admin signature (base64-encoded).
 *                 example: "FALC512_BASE64_SIGNATURE_HERE..."
 *           example:
 *             chain: "POLYGON"
 *             signature: "FALC512_BASE64_SIGNATURE_HERE..."
 *     responses:
 *       200:
 *         description: Chain resumed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         chain:
 *                           type: string
 *                           example: "POLYGON"
 *                         paused:
 *                           type: boolean
 *                           example: false
 *       400:
 *         description: Missing required fields.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient role — ADMIN required, or invalid Falcon-512 signature.
 */
router.post('/resume', requireApiKey, tenantRateLimiter, requireAdmin, async (req, res) => {
    try {
        const { chain, signature } = req.body;
        if (!chain || !signature) {
            return res.status(400).json({ success: false, error: 'chain and signature required' });
        }

        const service = CircuitBreakerService.getInstance();
        const result = await service.resumeChain(chain as any, signature);

        res.json({ success: true, data: result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @openapi
 * /api/v1/circuit-breaker/pause-all:
 *   post:
 *     summary: Emergency pause ALL chains
 *     description: |
 *       Global panic button — pauses all chains simultaneously. Typically triggered
 *       automatically by `SecurityWatchdogService` on anomaly detection, but can be
 *       called manually by an ADMIN with a valid Falcon-512 signature.
 *
 *       **This action affects all tenants. Use with caution.**
 *     tags: [Circuit Breaker]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signature]
 *             properties:
 *               signature:
 *                 type: string
 *                 description: Falcon-512 admin signature (base64-encoded).
 *                 example: "FALC512_BASE64_SIGNATURE_HERE..."
 *               reason:
 *                 type: string
 *                 example: "Critical vulnerability discovered in bridge contract."
 *           example:
 *             signature: "FALC512_BASE64_SIGNATURE_HERE..."
 *             reason: "Critical vulnerability discovered in bridge contract."
 *     responses:
 *       200:
 *         description: All chains paused.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           chain:
 *                             type: string
 *                           paused:
 *                             type: boolean
 *       400:
 *         description: Missing signature.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient role — ADMIN required, or invalid Falcon-512 signature.
 */
router.post('/pause-all', requireApiKey, tenantRateLimiter, requireAdmin, async (req, res) => {
    try {
        const { signature, reason } = req.body;
        if (!signature) {
            return res.status(400).json({ success: false, error: 'signature required' });
        }

        const service = CircuitBreakerService.getInstance();
        const results = await service.pauseAllChains('ADMIN_MANUAL', reason || 'Manual admin trigger');

        res.json({ success: true, data: results });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
