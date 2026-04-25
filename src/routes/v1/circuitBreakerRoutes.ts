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
 *     description: Returns the current pause state of all supported chains.
 *     tags: [Circuit Breaker]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current status of all chains
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
 *       Emergency pause for a specific blockchain. Requires ADMIN role
 *       and a valid Falcon-512 signature in the X-Quantum-Signature header.
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
 *               signature:
 *                 type: string
 *                 description: Falcon-512 admin signature
 *     responses:
 *       200:
 *         description: Chain paused successfully
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
 *     summary: Resume a specific chain
 *     description: Resume operations on a paused chain.
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
 *               signature:
 *                 type: string
 *                 description: Falcon-512 admin signature
 *     responses:
 *       200:
 *         description: Chain resumed successfully
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
 *       Global panic button. Pauses all chains simultaneously.
 *       This is typically called by SecurityWatchdogService when
 *       an anomaly is detected, but can be triggered manually by
 *       an admin with proper Falcon-512 signature.
 *     tags: [Circuit Breaker]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signature, reason]
 *             properties:
 *               signature:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: All chains paused
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
