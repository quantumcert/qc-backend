// Route index — Diamond Pattern API Router
// EIP-2535 architecture: mounts v1 facets.

import { Router, Request, Response } from 'express';
import { SDMVerifierService } from '../services/SDMVerifierService';
import tenantRoutes from './v1/tenantRoutes';
import apiKeyRoutes from './v1/apiKeyRoutes';
import assetRoutes from './v1/assetRoutes';
import deviceRoutes from './v1/deviceRoutes';
import publicRoutes from './v1/publicRoutes';
import authRoutes from './v1/authRoutes';
import webhookRoutes from './v1/webhookRoutes';
import walletRoutes from './v1/walletRoutes';
import circuitBreakerRoutes from './v1/circuitBreakerRoutes';
import agentRoutes from './v1/agentRoutes';
import contributionRoutes from './v1/contributionRoutes';
import adminRoutes from './v1/adminRoutes';
import userRoutes from './v1/userRoutes';
import { DiamondProxy } from '../diamond/DiamondProxy';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { apiRequestAudit } from '../middleware/apiRequestAudit';

const router = Router();

router.use(apiRequestAudit);

// Human auth — public browser/session routes; never requires tenant API key.
router.use('/v1/auth', authRoutes);

// ═══════════════════════════════════════════════════════════
// PHASE 1: Multi-Tenant Engine & Access Control
// ═══════════════════════════════════════════════════════════

// Tenant Management — CRUD + Deactivation + Usage Stats
router.use('/v1/tenants', tenantRoutes);

// API Key Management — Generate, List, Revoke, Rotate
router.use('/v1/api-keys', apiKeyRoutes);

// ═══════════════════════════════════════════════════════════
// PHASE 2: Asset Engine & Zero-Knowledge Security
// ═══════════════════════════════════════════════════════════

// Asset Management — Agnostic CRUD + Multi-ownership
router.use('/v1/assets', assetRoutes);

// Device & Hardware — Registration + Zero-Knowledge Taps
router.use('/v1/devices', deviceRoutes);

// ═══════════════════════════════════════════════════════════
// PHASE 3 / SUB-SISTEMA 3: Public Routes
// ═══════════════════════════════════════════════════════════
router.use('/v1/public', publicRoutes);

// ═══════════════════════════════════════════════════════════
// SUB-SISTEMA 1: Core Gap Closure
// ═══════════════════════════════════════════════════════════

// MercadoPago Webhook — POST /api/v1/webhooks/mercadopago
router.use('/v1/webhooks', webhookRoutes);

// Custodial Wallet — GET /api/v1/wallet/deposit-address, GET /api/v1/wallet/balance
router.use('/v1/wallet', walletRoutes);

// Circuit Breaker — POST /api/v1/circuit-breaker/pause, POST /api/v1/circuit-breaker/resume
router.use('/v1/circuit-breaker', circuitBreakerRoutes);

// ═══════════════════════════════════════════════════════════
// SUB-SISTEMA 4: M2M / Agent Registry
// ═══════════════════════════════════════════════════════════
router.use('/v1/agent', agentRoutes);

// ═══════════════════════════════════════════════════════════
// CURATION LAYER — CORE-06: Authenticated contribution review
// ═══════════════════════════════════════════════════════════
router.use('/v1/contributions', contributionRoutes);

// Canonical tenant-scoped users — B2C users live under Tenant Quantum.
router.use('/v1/users', userRoutes);

// ═══════════════════════════════════════════════════════════
// PHASE 4: Platform Admin Operations
// ═══════════════════════════════════════════════════════════
router.use('/v1/admin', adminRoutes);

/**
 * @openapi
 * /api/v1/diamond:
 *   post:
 *     summary: Diamond Proxy — universal Facet router
 *     description: |
 *       Single entry point for all authenticated mutating operations.
 *       The `selector` maps to a registered Facet function; the request
 *       context is injected by middleware before dispatch.
 *
 *       **Document verification & QTAG selectors:**
 *       - `event.recordAuthenticated` *(OPERATOR)* — records authenticated events; accepts `documentHash`
 *       - `commissioning.start` *(OPERATOR)* — creates a QTAG encoding session and returns one-time key material
 *       - `commissioning.confirm` *(OPERATOR)* — completes or fails a physical encoding session
 *       - `commissioning.status` *(OPERATOR)* — queries the status of an encoding session
 *
 *       **Other available selectors:**
 *       - `asset.create` *(OPERATOR)*
 *       - `asset.update` *(ADMIN)*
 *       - `lifecycle.transition` *(OPERATOR)*
 *       - `transfer.initiate` *(OPERATOR)*
 *       - `escrow.lock` *(OPERATOR)*
 *       - `escrow.release` *(OPERATOR)*
 *       - `escrow.cancel` *(ADMIN)*
 *       - `escrow.status` *(READER)*
 *       - `agent.register` *(ADMIN)*
 *     tags: [Diamond]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             lifecycle:
 *               summary: Transition an asset's lifecycle state
 *               value:
 *                 selector: lifecycle.transition
 *                 payload:
 *                   assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   targetState: ACTIVE
 *             transfer:
 *               summary: Initiate an ownership transfer
 *               value:
 *                 selector: transfer.initiate
 *                 payload:
 *                   assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   buyerDocument: "123.456.789-01"
 *                   documentType: CPF
 *             escrowLock:
 *               summary: Lock an asset in escrow with a time-lock
 *               value:
 *                 selector: escrow.lock
 *                 payload:
 *                   assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   escrowId: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *                   chain: SOLANA
 *                   sender: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 *                   receiver: "0xFe2b41890cC0B1be0Bc45Dd4ACe0Ea16D00e78A"
 *                   amount: "1000000"
 *                   unlockTimestamp: 1800000000
 *                   releaseMode: AUTO
 *             escrowStatus:
 *               summary: Query escrow status
 *               value:
 *                 selector: escrow.status
 *                 payload:
 *                   escrowId: "d290f1ee-6c54-4b01-90e6-d701748f0851"
 *             eventRecordAuthenticatedDocument:
 *               summary: Record an authenticated document hash
 *               description: |
 *                 Bridge used by integrations such as qc-record-module. The `documentHash`
 *                 must be a 128-character SHA3-512 hex string. Duplicates are idempotent per tenant.
 *               value:
 *                 selector: event.recordAuthenticated
 *                 payload:
 *                   assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   origin: "QC_RECORD_MODULE"
 *                   documentHash: "a3f9b2e1d4c7f8091011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859606162636465666768"
 *                   payload:
 *                     type: "DOCUMENT_VERIFICATION"
 *                     filename: "certificate.pdf"
 *             commissioningStart:
 *               summary: Start QTAG commissioning
 *               description: |
 *                 Returns `sessionId`, `layout`, 36 `pages` in base64, `sdmMacKey`,
 *                 `writeKey`, and `lockAfterWrite`. `sdmMacKey` and `writeKey` are
 *                 exposed once only to the physical encoding station and are not
 *                 stored in plaintext.
 *               value:
 *                 selector: commissioning.start
 *                 payload:
 *                   assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                   ntagUID: "045c8f82322190"
 *                   metadata:
 *                     stationId: "STATION-01"
 *                     batchId: "QTAG-2026-001"
 *             commissioningConfirm:
 *               summary: Confirm QTAG commissioning
 *               description: |
 *                 Call with `success: true` only after the physical write succeeds.
 *                 On failure, call with `success: false` — the next `commissioning.start`
 *                 must generate a new session with new key material.
 *               value:
 *                 selector: commissioning.confirm
 *                 payload:
 *                   sessionId: "sess_01H8XYZABC123456DEF789"
 *                   success: true
 *                   bytesWritten: 144
 *                   ntagUID: "045c8f82322190"
 *             commissioningStatus:
 *               summary: Query QTAG commissioning status
 *               value:
 *                 selector: commissioning.status
 *                 payload:
 *                   sessionId: "sess_01H8XYZABC123456DEF789"
 *           schema:
 *             type: object
 *             required: [selector, payload]
 *             properties:
 *               selector:
 *                 type: string
 *                 example: lifecycle.transition
 *               payload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Facet executed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             examples:
 *               commissioningStart:
 *                 summary: Response from commissioning.start
 *                 value:
 *                   success: true
 *                   data:
 *                     sessionId: "sess_01H8XYZABC123456DEF789"
 *                     layout: "AQAEXA==..."
 *                     pages: ["AQAEXA==", "j4IyIQ=="]
 *                     sdmMacKey: "a2f3b4c5d6e7f80910111213141516"
 *                     writeKey: "b3c4d5e6f7081920212223242526272"
 *                     lockAfterWrite: true
 *                   meta:
 *                     selector: commissioning.start
 *                     executionMode: DELEGATE_CALL
 *                     timestamp: "2026-06-30T22:00:00.000Z"
 *               commissioningConfirm:
 *                 summary: Response from commissioning.confirm
 *                 value:
 *                   success: true
 *                   data:
 *                     status: COMPLETED
 *                     sessionId: "sess_01H8XYZABC123456DEF789"
 *                   meta:
 *                     selector: commissioning.confirm
 *                     executionMode: DELEGATE_CALL
 *                     timestamp: "2026-06-30T22:01:00.000Z"
 *       400:
 *         description: Business error — invalid selector, forbidden state transition, escrow already closed, etc.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient role for the requested selector.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// The Universal EIP-2535 Router
router.post('/v1/diamond', requireApiKey, DiamondProxy.delegateCall);

// ═══════════════════════════════════════════════════════════
// QTAG SDM Scan — public endpoint, no apiKeyAuth
// Rate limit is applied in server.ts before this route
// ═══════════════════════════════════════════════════════════
/**
 * @openapi
 * /api/v1/scan:
 *   get:
 *     summary: Verify a public QTAG scan via SDM
 *     description: |
 *       Public endpoint called by a smartphone when reading an NTAG 424 DNA tag
 *       configured with Secure Dynamic Messaging (SDM). The tag generates `p` (`picc_data`)
 *       and `m` (`cmac`) on every read; the backend decrypts them, validates the CMAC,
 *       blocks replay attacks via a monotonically increasing counter, and returns
 *       `APPROVED` or `DENIED`.
 *
 *       The `uid` query parameter is optional but recommended — it allows the backend
 *       to locate the Device record before decrypting `picc_data`.
 *     tags: [QTAG]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: p
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 32
 *           maxLength: 32
 *           pattern: '^[0-9A-Fa-f]{32}$'
 *           example: "00112233445566778899aabbccddeeff"
 *         description: NTAG SDM `picc_data` (encrypted), 16 bytes as hex.
 *       - in: query
 *         name: m
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 16
 *           maxLength: 16
 *           pattern: '^[0-9A-Fa-f]{16}$'
 *           example: "a1b2c3d4e5f60708"
 *         description: NTAG SDM truncated CMAC, 8 bytes as hex.
 *       - in: query
 *         name: uid
 *         required: false
 *         schema:
 *           type: string
 *           minLength: 14
 *           maxLength: 14
 *           pattern: '^[0-9A-Fa-f]{14}$'
 *           example: "045c8f82322190"
 *         description: Plaintext tag UID for Device lookup (7 bytes as hex, no separators).
 *       - in: query
 *         name: lat
 *         required: false
 *         schema:
 *           type: number
 *           format: double
 *           example: -23.55052
 *         description: Optional latitude for relay-attack heuristics.
 *       - in: query
 *         name: lon
 *         required: false
 *         schema:
 *           type: number
 *           format: double
 *           example: -46.633308
 *         description: Optional longitude for relay-attack heuristics.
 *     responses:
 *       200:
 *         description: Authentic QTAG — scan approved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [status, counter, asset]
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [APPROVED]
 *                 counter:
 *                   type: integer
 *                   example: 42
 *                 asset:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     publicUrl:
 *                       type: string
 *                     metadata:
 *                       type: object
 *                     anchorTxId:
 *                       type: string
 *                       nullable: true
 *                     blockHeight:
 *                       type: integer
 *                       nullable: true
 *                     status:
 *                       type: string
 *       400:
 *         description: Missing or malformed parameters.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing required parameters: p, m"
 *       403:
 *         description: QTAG rejected — invalid CMAC, replay attack, relay attack, or device not found/inactive.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [status, reason, message]
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [DENIED]
 *                 reason:
 *                   type: string
 *                   enum: [MAC_INVALID, REPLAY_ATTACK, RELAY_ATTACK, DEVICE_NOT_FOUND, DEVICE_INACTIVE]
 *                   example: "MAC_INVALID"
 *                 message:
 *                   type: string
 *                   example: "Invalid CMAC signature."
 *       429:
 *         description: Public rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Too many requests. Try again later."
 */
router.get('/v1/scan', async (req: Request, res: Response) => {
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

// ═══════════════════════════════════════════════════════════
// PHASE 4: Events & Quarantine (PLACEHOLDER)
// router.use('/v1/events', eventRoutes);
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// PHASE 5: Status & Double-Blind (PLACEHOLDER)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// PHASE 6: DLT Abstraction (PLACEHOLDER)
// ═══════════════════════════════════════════════════════════

export default router;
