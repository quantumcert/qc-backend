// ═══════════════════════════════════════════════════════════
// ROUTE INDEX — Diamond Pattern API Router
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Centralized route mounting point for all API facets.
// Mounts all versioned routes under /api/v1/*.
//
// Phase 1 Routes:
//   /api/v1/tenants/*   → Tenant Management (TenantManagementFacet)
//   /api/v1/api-keys/*  → API Key Lifecycle (ApiKeyManagementFacet)
//   /api/health         → Health Check
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { SDMVerifierService } from '../services/SDMVerifierService';
import tenantRoutes from './v1/tenantRoutes';
import apiKeyRoutes from './v1/apiKeyRoutes';
import assetRoutes from './v1/assetRoutes';
import deviceRoutes from './v1/deviceRoutes';
import publicRoutes from './v1/publicRoutes';
import lifecycleRoutes from './v1/lifecycleRoutes';
import webhookRoutes from './v1/webhookRoutes';
import walletRoutes from './v1/walletRoutes';
import circuitBreakerRoutes from './v1/circuitBreakerRoutes';
import agentRoutes from './v1/agentRoutes';
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

// Lifecycle State Machine — PATCH /api/v1/assets/:assetId/lifecycle
router.use('/v1/assets', lifecycleRoutes);

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

/**
 * @openapi
 * /api/v1/diamond:
 *   post:
 *     summary: Diamond Proxy — roteador universal de Facets
 *     description: |
 *       Ponto de entrada para operações via Diamond Pattern. O selector mapeia para
 *       uma função de Facet registrada no FacetRegistry. O secureContext é injetado
 *       pelo middleware — nunca confie em tenantId vindo do payload.
 *     tags: [Diamond]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DiamondCallPayload'
 *     responses:
 *       200:
 *         description: Facet executado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Selector inválido ou não registrado no FacetRegistry
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
