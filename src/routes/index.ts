// Route index — Diamond Pattern API Router
// EIP-2535 architecture: mounts v1 facets.

import { Router, Request, Response } from 'express';
import { SDMVerifierService } from '../services/SDMVerifierService';
import tenantRoutes from './v1/tenantRoutes';
import apiKeyRoutes from './v1/apiKeyRoutes';
import assetRoutes from './v1/assetRoutes';
import deviceRoutes from './v1/deviceRoutes';
import publicRoutes from './v1/publicRoutes';
import webhookRoutes from './v1/webhookRoutes';
import walletRoutes from './v1/walletRoutes';
import circuitBreakerRoutes from './v1/circuitBreakerRoutes';
import agentRoutes from './v1/agentRoutes';
import contributionRoutes from './v1/contributionRoutes';
import { DiamondProxy } from '../diamond/DiamondProxy';
import { requireApiKey } from '../middleware/apiKeyAuth';

const router = Router();

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

/**
 * @openapi
 * /api/v1/diamond:
 *   post:
 *     summary: Diamond Proxy - roteador universal de Facets
 *     description: |
 *       Entrada unica para operacoes mutantes autenticadas.
 *       O selector mapeia para uma funcao registrada de Facet.
 *       O contexto seguro e injetado pelo middleware.
 *
 *       Selectors disponiveis:
 *       - asset.register (OPERATOR)
 *       - asset.update (OPERATOR)
 *       - lifecycle.transition (OPERATOR)
 *       - transfer.initiate (OPERATOR)
 *       - escrow.lock (OPERATOR)
 *       - escrow.release (OPERATOR)
 *       - escrow.cancel (ADMIN)
 *       - escrow.status (READER)
 *       - agent.register (ADMIN)
 *       - commissioning.start (OPERATOR)
 *     tags: [Diamond]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             lifecycle:
 *               summary: Transicionar estado de um ativo
 *               value:
 *                 selector: lifecycle.transition
 *                 payload:
 *                   assetId: "uuid-do-ativo"
 *                   targetState: ACTIVE
 *             transfer:
 *               summary: Iniciar transferência de propriedade
 *               value:
 *                 selector: transfer.initiate
 *                 payload:
 *                   assetId: "uuid-do-ativo"
 *                   buyerDocument: "123.456.789-00"
 *                   documentType: CPF
 *             escrowLock:
 *               summary: Bloquear ativo em escrow com time-lock
 *               value:
 *                 selector: escrow.lock
 *                 payload:
 *                   assetId: "uuid-do-ativo"
 *                   escrowId: "uuid-do-escrow"
 *                   chain: SOLANA
 *                   sender: "carteira-vendedor"
 *                   receiver: "carteira-comprador"
 *                   amount: "1000000"
 *                   unlockTimestamp: 1800000000
 *                   releaseMode: AUTO
 *             escrowStatus:
 *               summary: Consultar status de um escrow
 *               value:
 *                 selector: escrow.status
 *                 payload:
 *                   escrowId: "uuid-do-escrow"
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
 *         description: Facet executado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Erro de negócio (selector inválido, estado proibido, escrow já fechado, etc.)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role insuficiente para o selector solicitado
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
