// ============================================================
// WALLET ROUTES -- Custodial Deposit Flow
// Rebuilt from deprecated stub.
//
// GET /wallet/deposit-address?chain=POLYGON
// GET /wallet/balance?chain=POLYGON (optional chain filter)
// ============================================================

import { Router } from 'express';
import { WalletController } from '../../controllers/WalletController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireReader } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

/**
 * @openapi
 * /api/v1/wallet/deposit-address:
 *   get:
 *     summary: Get deposit address for a specific chain
 *     description: |
 *       Returns the custodial deposit address for the authenticated tenant
 *       on the requested blockchain. If no wallet exists, one is created
 *       deterministically from the master key.
 *     tags: [Wallet]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: chain
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ETHEREUM, POLYGON, ALGORAND]
 *         description: Blockchain network for the deposit address
 *     responses:
 *       200:
 *         description: Deposit address retrieved
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
 *                         address:
 *                           type: string
 *                           example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 *                         chain:
 *                           type: string
 *                           example: "POLYGON"
 *                         pqcPublicKey:
 *                           type: string
 *                           nullable: true
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *       400:
 *         description: Invalid chain parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: API key missing or invalid
 */
router.get(
  '/deposit-address',
  requireApiKey,
  tenantRateLimiter,
  requireReader,
  WalletController.getDepositAddress
);

/**
 * @openapi
 * /api/v1/wallet/balance:
 *   get:
 *     summary: Get internal balance
 *     description: |
 *       Aggregates all CONFIRMED stablecoin deposits and subtracts
 *       outgoing transfers to show the tenant's current internal balance.
 *     tags: [Wallet]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: chain
 *         required: false
 *         schema:
 *           type: string
 *           enum: [ETHEREUM, POLYGON, ALGORAND]
 *         description: Filter balance by chain (default = all chains)
 *     responses:
 *       200:
 *         description: Balance computed
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
 *                         tenantId:
 *                           type: string
 *                         chain:
 *                           type: string
 *                         totalDeposited:
 *                           type: string
 *                         totalSpent:
 *                           type: string
 *                         balance:
 *                           type: string
 *                         currency:
 *                           type: string
 *                           example: "USDC"
 *                         depositCount:
 *                           type: integer
 *       401:
 *         description: API key missing or invalid
 */
router.get(
  '/balance',
  requireApiKey,
  tenantRateLimiter,
  requireReader,
  WalletController.getBalance
);

export default router;

