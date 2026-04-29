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
 *       Ponto de entrada único para todas as operações mutantes autenticadas.
 *       O `selector` mapeia para uma função de Facet registrada no FacetRegistry.
 *       O `secureContext` ({ tenantId, apiKeyId, role }) é injetado pelo middleware
 *       — nunca confie em tenantId vindo do payload.
 *
 *       **Seletores disponíveis:**
 *
 *       | Selector | Descrição | Role mínimo |
 *       |---|---|---|
 *       | `asset.register` | Criar novo ativo | OPERATOR |
 *       | `asset.update` | Atualizar metadata | OPERATOR |
 *       | `lifecycle.transition` | Transicionar estado do ativo | OPERATOR |
 *       | `transfer.initiate` | Iniciar transferência de propriedade | OPERATOR |
 *       | `escrow.lock` | Bloquear ativo em escrow time-lock | OPERATOR |
 *       | `escrow.release` | Liberar escrow MANUAL | OPERATOR |
 *       | `escrow.cancel` | Cancelar escrow | ADMIN |
 *       | `escrow.status` | Consultar status do escrow | READER |
 *       | `agent.register` | Registrar agente M2M/IoT | ADMIN |
 *       | `agent.revoke` | Revogar agente | ADMIN |
 *       | `agent.status` | Consultar status do agente | READER |
 *       | `commissioning.start` | Iniciar comissionamento de tag NFC | OPERATOR |
 *       | `commissioning.finalize` | Finalizar comissionamento | OPERATOR |
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
