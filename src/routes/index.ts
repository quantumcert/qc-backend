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
 *       Entrada única para operações mutantes autenticadas.
 *       O selector mapeia para uma função registrada de Facet.
 *       O contexto seguro é injetado pelo middleware.
 *
 *       Selectors de document verification e QTAG:
 *       - event.recordAuthenticated (OPERATOR): registra eventos autenticados e aceita `documentHash`
 *       - commissioning.start (OPERATOR): cria sessão de gravação QTAG e retorna material one-time
 *       - commissioning.confirm (OPERATOR): conclui ou falha uma sessão de gravação física
 *       - commissioning.status (OPERATOR): consulta status da sessão de gravação
 *
 *       Outros selectors disponíveis:
 *       - asset.create (OPERATOR)
 *       - asset.update (ADMIN)
 *       - lifecycle.transition (OPERATOR)
 *       - transfer.initiate (OPERATOR)
 *       - escrow.lock (OPERATOR)
 *       - escrow.release (OPERATOR)
 *       - escrow.cancel (ADMIN)
 *       - escrow.status (READER)
 *       - agent.register (ADMIN)
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
 *             eventRecordAuthenticatedDocument:
 *               summary: Registrar hash documental autenticado
 *               description: |
 *                 Bridge usado por integrações como qc-record-module. O `documentHash`
 *                 deve ser SHA3-512 em hex com 128 caracteres. Duplicatas são idempotentes
 *                 por tenant.
 *               value:
 *                 selector: event.recordAuthenticated
 *                 payload:
 *                   assetId: "uuid-do-ativo"
 *                   origin: "QC_RECORD_MODULE"
 *                   documentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
 *                   payload:
 *                     type: "DOCUMENT_VERIFICATION"
 *                     filename: "certificate.pdf"
 *             commissioningStart:
 *               summary: Iniciar commissioning QTAG
 *               description: |
 *                 Retorna `sessionId`, `layout`, 36 `pages` em base64, `sdmMacKey`,
 *                 `writeKey` e `lockAfterWrite`. `sdmMacKey` e `writeKey` são expostos
 *                 uma única vez para a estação física de gravação e não são persistidos
 *                 em plaintext.
 *               value:
 *                 selector: commissioning.start
 *                 payload:
 *                   assetId: "uuid-do-ativo"
 *                   ntagUID: "045c8f82322190"
 *                   metadata:
 *                     stationId: "ESTACAO-01"
 *                     batchId: "QTAG-2026-001"
 *             commissioningConfirm:
 *               summary: Confirmar commissioning QTAG
 *               description: |
 *                 Chame com `success: true` somente depois da gravação física. Se a
 *                 gravação falhar, chame com `success: false`; o próximo
 *                 `commissioning.start` deve gerar nova sessão e novas chaves.
 *               value:
 *                 selector: commissioning.confirm
 *                 payload:
 *                   sessionId: "encoding-session-id"
 *                   success: true
 *                   bytesWritten: 144
 *                   ntagUID: "045c8f82322190"
 *             commissioningStatus:
 *               summary: Consultar status do commissioning QTAG
 *               value:
 *                 selector: commissioning.status
 *                 payload:
 *                   sessionId: "encoding-session-id"
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
 *             examples:
 *               commissioningStart:
 *                 summary: Retorno de commissioning.start
 *                 value:
 *                   success: true
 *                   data:
 *                     sessionId: "encoding-session-id"
 *                     layout: "base64-layout-144-bytes"
 *                     pages: ["AQAEXA==", "j4IyIQ=="]
 *                     sdmMacKey: "d9c12fff5ea810b5edfb8b7730272c1b"
 *                     writeKey: "85a2d097370e1843bbd30529112b74f9"
 *                     lockAfterWrite: true
 *                   meta:
 *                     selector: commissioning.start
 *                     executionMode: DELEGATE_CALL
 *                     timestamp: "2026-05-13T22:52:33.323Z"
 *               commissioningConfirm:
 *                 summary: Retorno de commissioning.confirm
 *                 value:
 *                   success: true
 *                   data:
 *                     status: COMPLETED
 *                     sessionId: "encoding-session-id"
 *                   meta:
 *                     selector: commissioning.confirm
 *                     executionMode: DELEGATE_CALL
 *                     timestamp: "2026-05-13T22:53:14.499Z"
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
/**
 * @openapi
 * /api/v1/scan:
 *   get:
 *     summary: Verificar scan público de QTAG via SDM
 *     description: |
 *       Endpoint público usado pelo smartphone ao ler uma NTAG 424 DNA configurada
 *       com Secure Dynamic Messaging (SDM). A tag gera `p` (`picc_data`) e `m`
 *       (`cmac`) a cada leitura; o backend decripta, valida o CMAC, bloqueia replay
 *       por contador monotonicamente crescente e retorna `APPROVED` ou `DENIED`.
 *
 *       A query `uid` é opcional, mas recomendada no MVP para localizar o Device
 *       antes da decriptação do `picc_data`.
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
 *         description: NTAG SDM `picc_data` cifrado, 16 bytes em hex.
 *       - in: query
 *         name: m
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 16
 *           maxLength: 16
 *           pattern: '^[0-9A-Fa-f]{16}$'
 *           example: "a1b2c3d4e5f60708"
 *         description: NTAG SDM CMAC truncado, 8 bytes em hex.
 *       - in: query
 *         name: uid
 *         required: false
 *         schema:
 *           type: string
 *           minLength: 14
 *           maxLength: 14
 *           pattern: '^[0-9A-Fa-f]{14}$'
 *           example: "045c8f82322190"
 *         description: UID plaintext da tag para lookup do Device.
 *       - in: query
 *         name: lat
 *         required: false
 *         schema:
 *           type: number
 *           format: double
 *           example: -23.55052
 *         description: Latitude opcional para heurística anti-relay.
 *       - in: query
 *         name: lon
 *         required: false
 *         schema:
 *           type: number
 *           format: double
 *           example: -46.633308
 *         description: Longitude opcional para heurística anti-relay.
 *     responses:
 *       200:
 *         description: QTAG autêntico aprovado
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
 *         description: Parâmetros ausentes ou malformados
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing required parameters: p, m"
 *       403:
 *         description: QTAG rejeitado por autenticidade, replay, relay ou Device ausente/inativo
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
 *                 message:
 *                   type: string
 *                   example: "Assinatura inválida."
 *       429:
 *         description: Rate limit público excedido
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
