# Phase 1: Core Gap Closure + Production Hardening — Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 14 (new/modified)
**Analogs found:** 13 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/services/QuantumSignerService.ts` | service | request-response | `src/utils/PostQuantumCrypto.ts` | role-match |
| `src/services/CircuitBreakerService.ts` | service | request-response | `src/utils/PostQuantumCrypto.ts` + `src/services/QuantumSignerService.ts` | role-match |
| `src/services/AnchorQueueService.ts` | service | batch + CRUD | self (modificação pontual) | exact |
| `src/diamond/FacetRegistry.ts` | config | request-response | self (adição de linha) | exact |
| `src/services/core-facets/DocumentVerificationFacet.ts` | service | request-response | `src/services/core-facets/LifecycleFacet.ts` | role-match |
| `src/services/core-facets/CurationFacet.ts` | service | CRUD + event-driven | `src/services/core-facets/EventLogFacet.ts` | exact |
| `src/routes/v1/publicRoutes.ts` | route | request-response | self (adição de rota) + `src/routes/v1/assetRoutes.ts` | exact |
| `src/routes/v1/assetRoutes.ts` | route | request-response | self (adição de PATCH) | exact |
| `src/routes/index.ts` | route | request-response | self (adição de mount) | exact |
| `src/services/SchedulerService.ts` | service | batch + event-driven | self (adição de cron job) | exact |
| `src/controllers/WebhookController.ts` | controller | request-response | self (verificação) | exact |
| `prisma/schema.prisma` | model | CRUD | modelos `EventLog` + `Tenant` existentes | exact |
| `src/services/core-facets/AlgorandAnchorFacet.ts` | service | CRUD | `src/services/AnchorQueueService.ts` | role-match |
| `src/services/core-facets/LifecycleFacet.ts` | service | CRUD + event-driven | self (verificação/ajuste) | exact |

---

## Pattern Assignments

### `src/services/QuantumSignerService.ts` (service, request-response)
**Req:** SEC-02 — conectar `verifySignature()` ao `PostQuantumCrypto.verifySignatureFalcon512()`

**Analog:** `src/utils/PostQuantumCrypto.ts`

**Stub a ser removido** (linhas 108-117):
```typescript
// REMOVER — comentário e return true são o stub:
async verifySignature(
    _payload: object,
    _signatureBase64: string,
    _publicKeyHex: string
): Promise<boolean> {
    // falcon-crypto v1.0.6 does not export verifyDetached.
    // ...
    return true;  // <-- STUB — REMOVER
}
```

**Implementação real a substituir** (baseada no padrão de `PostQuantumCrypto.verifySignatureFalcon512`, linha 138):
```typescript
// src/utils/PostQuantumCrypto.ts, linhas 138-153 — padrão de verificação:
static async verifySignatureFalcon512(
    message: string,
    signatureB64: string,
    publicKeyB64: string
): Promise<boolean> {
    try {
        const messageBytes = Buffer.from(message);
        const signature = Buffer.from(signatureB64, 'base64');
        const publicKey = Buffer.from(publicKeyB64, 'base64');
        return await falcon.verifyDetached(signature, messageBytes, publicKey);
    } catch {
        return false;
    }
}
```

**Implementação que QuantumSignerService.verifySignature deve ter:**
```typescript
// Imports necessários (já existentes no topo do arquivo):
import { PostQuantumCrypto } from '../utils/PostQuantumCrypto';

// Método substituído:
async verifySignature(
    payload: object,
    signatureBase64: string,
    publicKeyHex: string
): Promise<boolean> {
    const message = JSON.stringify(payload);
    const publicKeyB64 = Buffer.from(publicKeyHex, 'hex').toString('base64');
    return PostQuantumCrypto.verifySignatureFalcon512(message, signatureBase64, publicKeyB64);
}
```

---

### `src/services/CircuitBreakerService.ts` (service, request-response)
**Req:** SEC-03 — `verifyAdminSignature()` usa verificação Falcon-512 real em vez de aceitar qualquer string

**Analog:** `src/services/CircuitBreakerService.ts` (automodificação) + `src/services/QuantumSignerService.ts`

**Pattern de env var guard** (copiar da validação de `CIRCUIT_BREAKER_ADMIN_PUBKEY`):
```typescript
// Dentro de verifyAdminSignature() — padrão a adotar:
private async verifyAdminSignature(action: string, chain: string, signature: string): Promise<boolean> {
    const adminPubKey = process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY;
    if (!adminPubKey) {
        // Dev fallback: log warning, return false (fail-secure)
        if (process.env.NODE_ENV === 'production') {
            throw new Error('CIRCUIT_BREAKER_ADMIN_PUBKEY not configured');
        }
        console.warn('[CircuitBreaker] CIRCUIT_BREAKER_ADMIN_PUBKEY not set — rejecting signature in fail-secure mode');
        return false;
    }
    const message = JSON.stringify({ action, chain });
    return this.quantumSigner.verifySignature({ action, chain }, signature, adminPubKey);
}
```

**Pattern de injeção de env var** — copiar de `src/services/SchedulerService.ts` linhas 16-17:
```typescript
// Leitura de env var com fallback numérico (padrão existente):
const intervalSeconds = parseInt(process.env.ANCHOR_QUEUE_INTERVAL_SECONDS ?? '30', 10);
```

---

### `src/services/AnchorQueueService.ts` (service, batch)
**Req:** SEC-04 — trocar `findMany` inicial por `SELECT FOR UPDATE SKIP LOCKED` dentro de transação

**Analog:** `src/services/AnchorQueueService.ts` (automodificação) — linha 13 em diante

**Padrão atual a ser substituído** (linhas 14-22):
```typescript
// REMOVER — findMany sem lock pessimista:
const pendingEvents = await prisma.eventLog.findMany({
    where: {
        status: { in: ['APPROVED', 'PENDING_FUNDS'] },
        dltTxId: null,
        signatureHash: { not: null },
    },
    orderBy: { id: 'asc' },
    take: 10,
});
```

**Padrão a adotar — `$queryRaw` dentro de `$transaction`:**
```typescript
// SUBSTITUIR por — SELECT FOR UPDATE SKIP LOCKED dentro de transação:
// Atenção: SKIP LOCKED requer transação ativa. Usar prisma.$transaction().
const lockedEvents = await prisma.$transaction(async (tx) => {
    const pendingEvents = await tx.$queryRaw<Array<{
        id: string;
        assetId: string;
        tenantId: string;
        signatureHash: string;
    }>>`
        SELECT id, "assetId", "tenantId", "signatureHash"
        FROM "EventLog"
        WHERE status IN ('APPROVED', 'PENDING_FUNDS')
          AND "dltTxId" IS NULL
          AND "signatureHash" IS NOT NULL
        ORDER BY id ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
    `;
    return pendingEvents;
});
```

**Padrão de early-return** (linha 24-27 — manter):
```typescript
if (pendingEvents.length === 0) {
    console.log('[AnchorQueue] No pending events to anchor.');
    return { processed: 0, items: [] };
}
```

**Padrão de erro com try/catch** (linhas 87-124 — manter inalterado): o loop de erros com `RetryWorker.enqueue()` e `WebhookDispatcher.dispatch()` já é correto.

---

### `src/diamond/FacetRegistry.ts` (config, request-response)
**Req:** SEC-05 — adicionar `document.verify` ao registry

**Analog:** `src/diamond/FacetRegistry.ts` — linhas 64-67 (padrão de lambda wrapper para EscrowFacet)

**Padrão de import** (linhas 7-18 — copiar estrutura):
```typescript
// Adicionar import no bloco existente:
import { DocumentVerificationFacet } from '../services/core-facets/DocumentVerificationFacet';
```

**Padrão de registro com wrapper** (linhas 64-67 como referência):
```typescript
// Padrão existente para EscrowFacet (lambda explícito):
'escrow.lock':    (ctx: any, payload: any) => EscrowFacet.lock(ctx, payload),

// Padrão para DocumentVerificationFacet — ctx ignorado (endpoint público via Diamond requer ctx):
// ATENÇÃO: harmonizar retorno para { verified: boolean } antes de registrar.
// Testes existentes (document-verification.test.ts) esperam campo 'verified', não 'valid'.
'document.verify': (_ctx: any, payload: any) => DocumentVerificationFacet.verifyByHash(payload.hash),
```

**Seção a adicionar no registry** (após `// EVENT LOG`, linha 33):
```typescript
// DOCUMENT VERIFICATION
'document.verify': (_ctx: any, payload: any) => DocumentVerificationFacet.verifyByHash(payload.hash),
```

---

### `src/services/core-facets/DocumentVerificationFacet.ts` (service, request-response)
**Req:** SEC-05 — harmonizar interface `{ valid }` → `{ verified }` para alinhar com testes existentes

**Analog:** `src/services/core-facets/LifecycleFacet.ts` (padrão de erro tipado com `httpStatus`)

**Padrão de interface de resposta** (linhas 23-28 de DocumentVerificationFacet — modificar):
```typescript
// ATUAL — interface a ser harmonizada:
export interface VerifyDocumentResponse {
    valid: boolean;        // <-- renomear para 'verified'
    asset: PublicAssetPanel | null;
    reason?: string;
}

// NOVO — interface harmonizada com testes:
export interface VerifyDocumentResponse {
    verified: boolean;
    asset: PublicAssetPanel | null;
    reason?: string;
}
```

**Padrão de retorno** (linhas 85-86 e 111-121 — atualizar campo):
```typescript
// ATUAL:
return { valid: false, asset: null, reason: 'Invalid hash format' };
// NOVO:
return { verified: false, asset: null, reason: 'Invalid hash format' };
```

**Nota:** A rota em `publicRoutes.ts` (linha 76-81) usa `result.valid` — atualizar junto com o Facet.

---

### `src/services/core-facets/CurationFacet.ts` (service, CRUD + event-driven)
**Req:** CORE-05, CORE-06 — arquivo NOVO

**Analog primário:** `src/services/core-facets/EventLogFacet.ts` (padrão de fluxo público + aprovação)
**Analog secundário:** `src/services/core-facets/BlindContactLogFacet.ts` (padrão de public submission sem auth)

**Padrão de imports** (copiar de EventLogFacet, linhas 1-6):
```typescript
import prisma from '../../config/prisma';
import { AnchorQueueService } from '../AnchorQueueService';
// Adicionar:
import { WebhookDispatcher } from '../../utils/WebhookDispatcher';
```

**Padrão de public submission sem secureContext** (BlindContactLogFacet, linhas 5-8):
```typescript
// BlindContactLogFacet — Facet público: recebe params diretos, não secureContext
static async submitContact(assetId: string, contactData: Record<string, any>, requesterIp: string | null) {
    return await prisma.$transaction(async (tx) => {
        const asset = await tx.asset.findUnique({ where: { id: assetId } });
```

**Padrão de lookup de asset → tenantId** (EventLogFacet, linhas 98-105):
```typescript
// Buscar asset para derivar tenantId — padrão universal nos Facets públicos:
const asset = await prisma.asset.findUnique({
    where: { id: assetId }
});
if (!asset) {
    throw new Error("Asset not found");
}
// asset.tenantId → disponível para scoping
```

**Padrão de criação de EventLog + fire-and-forget AnchorQueue** (EventLogFacet, linhas 56-84):
```typescript
// Padrão de transação com EventLog:
const result = await prisma.$transaction(async (tx) => {
    const event = await tx.eventLog.create({
        data: {
            assetId,
            tenantId: asset.tenantId,   // sempre do asset, nunca do payload
            origin: apiKeyId || 'PUBLIC',
            status: 'APPROVED',
            payload,
            signatureHash,
        }
    });
    await tx.auditLog.create({
        data: {
            tenantId: asset.tenantId,
            action: 'EVENT_CREATED',
            resourceType: 'EVENT',
            resourceId: event.id,
            metadata: { assetId, flow: 'CURATION_APPROVED' }
        }
    });
    return event;
});

// Fire-and-forget — padrão existente:
AnchorQueueService.processQueue().catch(console.error);
```

**Padrão de RBAC inline no Facet** (TransferRegistryFacet, linhas 25-29):
```typescript
// RBAC verificado dentro do Facet — padrão para reviewContribution():
if (role !== 'ADMIN' && role !== 'OPERATOR') {
    const err: any = new Error('Forbidden: Insufficient privileges to review contribution');
    err.code = 'INSUFFICIENT_PERMISSIONS';
    throw err;
}
```

**Padrão de makeError tipado** (LifecycleFacet, linhas 22-26):
```typescript
// Erro com campos code e httpStatus — padrão do projeto:
function makeError(message: string, code: string, httpStatus: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.httpStatus = httpStatus;
    return err;
}
```

**Skeleton do CurationFacet a implementar:**
```typescript
// src/services/core-facets/CurationFacet.ts
import prisma from '../../config/prisma';
import { AnchorQueueService } from '../AnchorQueueService';
import crypto from 'crypto';

export class CurationFacet {
    static async submitContribution(params: {
        assetId: string;
        phone?: string;
        email?: string;
        payload: Record<string, any>;
    }): Promise<{ queued: boolean; eventId?: string; pendingId?: string }> {
        // 1. Validate: phone or email must be present
        // 2. Fetch asset → derive tenantId (never from params)
        // 3. ownerRef = phone ?? email
        // 4. Query Contributor { tenantId, ownerRef, isAuditor: true }
        // 5a. Auditor → create EventLog(APPROVED) + AnchorQueueService.processQueue()
        // 5b. Non-auditor → create PendingContribution(PENDING_APPROVAL)
    }

    static async reviewContribution(
        secureContext: { tenantId: string; role: string; apiKeyId: string },
        payload: { pendingId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }
    ): Promise<void> {
        // 1. RBAC: role must be OPERATOR or ADMIN (usar padrão TransferRegistryFacet)
        // 2. Fetch PendingContribution by id AND tenantId (tenant isolation)
        // 3. Update status atomicamente
        // 4. If APPROVED → create EventLog + AnchorQueueService.processQueue()
        // 5. Create AuditLog com reviewedBy = secureContext.apiKeyId
    }
}
```

---

### `src/routes/v1/publicRoutes.ts` (route, request-response)
**Req:** CORE-05 — adicionar rota pública `POST /api/v1/public/asset/:assetId/contribution`

**Analog:** `src/routes/v1/publicRoutes.ts` — linhas 19-20 e 72-85 (padrão de rota pública sem auth)

**Padrão de import de Facet** (linha 10-11):
```typescript
// Padrão existente — import direto do Facet (sem controller intermediário para rotas simples):
import { DocumentVerificationFacet } from '../../services/core-facets/DocumentVerificationFacet';
// Adicionar:
import { CurationFacet } from '../../services/core-facets/CurationFacet';
```

**Padrão de rota pública inline** (linhas 72-85):
```typescript
// Padrão: handler inline com try/catch → next(err) para erros inesperados
router.get('/verify/document/:hash', async (req, res, next) => {
    try {
        const hash = req.params.hash;
        const result = await DocumentVerificationFacet.verifyByHash(hash);
        if (!result.valid) {
            return res.status(404).json({ valid: false, asset: null });
        }
        return res.status(200).json({ valid: true, asset: result.asset });
    } catch (err) {
        next(err);
    }
});
```

**Rota de contribuição a adicionar** (mesmo padrão):
```typescript
// POST /api/v1/public/asset/:assetId/contribution — sem requireApiKey
router.post('/asset/:assetId/contribution', async (req, res, next) => {
    try {
        const { assetId } = req.params;
        const { phone, email, payload } = req.body;
        const result = await CurationFacet.submitContribution({ assetId, phone, email, payload });
        return res.status(201).json({ success: true, data: result });
    } catch (err: any) {
        if (err.code === 'ASSET_NOT_FOUND') return res.status(404).json({ success: false, error: err.message });
        if (err.code === 'INVALID_PAYLOAD') return res.status(400).json({ success: false, error: err.message });
        next(err);
    }
});
```

---

### `src/routes/v1/assetRoutes.ts` (route, request-response)
**Req:** CORE-02 — adicionar `PATCH /api/v1/assets/:assetId/transfer`

**Analog:** `src/routes/v1/assetRoutes.ts` — linha 204 (padrão de PATCH com middleware chain)

**Padrão de PATCH autenticado com idempotency** (linha 204):
```typescript
// Padrão existente para PATCH com mudança de estado:
router.patch('/:id/owners', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, AssetController.addOwner);

// Padrão a seguir para a rota de transfer:
router.patch('/:assetId/transfer', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, TransferController.initiateTransfer);
```

**Padrão de imports** (linhas 9-13):
```typescript
import { Router } from 'express';
import { AssetController } from '../../controllers/AssetController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator, requireReader } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
// Adicionar:
import { TransferController } from '../../controllers/TransferController';
```

**Nota:** É necessário criar `TransferController` que extrai `secureContext` de `req` e chama `TransferRegistryFacet.initiateTransfer()`. Usar `BlindContactController` (linhas 1-41) como padrão de controller slim.

---

### `src/routes/index.ts` (route, request-response)
**Req:** CORE-05/06 — mount de nova rota de curadoria (se necessário) + verificar se publicRoutes já cobre

**Analog:** `src/routes/index.ts` — linhas 42-49 (padrão de `router.use()`)

**Padrão de mount** (linhas 42-49):
```typescript
// Padrão existente de mount com comentário de fase:
// SUB-SISTEMA 1: Core Gap Closure
router.use('/v1/webhooks', webhookRoutes);
router.use('/v1/wallet', walletRoutes);
// Nota: publicRoutes já montado em linha 42 — contribuição vai para /v1/public/*
// Não é necessário novo mount se rota for adicionada a publicRoutes.ts
```

---

### `src/services/SchedulerService.ts` (service, batch + event-driven)
**Req:** CORE-04 — verificar/adicionar cron job para processar `WebhookInbox`

**Analog:** `src/services/SchedulerService.ts` — linhas 38-62 (padrão de cron job com isRunning guard)

**Padrão de cron job com guard contra re-entrada** (linhas 18-34):
```typescript
// Padrão de isRunning guard — copiar exatamente para novo job:
let isRunning = false;
cron.schedule(cronPattern, async () => {
    if (isRunning) {
        console.log('[Scheduler] AnchorQueue already running, skipping this cycle.');
        return;
    }
    isRunning = true;
    try {
        await AnchorQueueService.processQueue();
    } catch (err) {
        console.error('[Scheduler] AnchorQueue error:', err);
    } finally {
        isRunning = false;
    }
});
```

**Padrão de interval de env var** (linha 16):
```typescript
const intervalSeconds = parseInt(process.env.ANCHOR_QUEUE_INTERVAL_SECONDS ?? '30', 10);
const cronPattern = `*/${intervalSeconds} * * * * *`;
```

**Job de WebhookInbox a adicionar** (mesma estrutura):
```typescript
// ─── Webhook Inbox Processor ────────────────────────────
let webhookInboxRunning = false;
const webhookInboxInterval = parseInt(process.env.WEBHOOK_INBOX_INTERVAL_SECONDS ?? '30', 10);
const webhookInboxPattern = `*/${webhookInboxInterval} * * * * *`;

cron.schedule(webhookInboxPattern, async () => {
    if (webhookInboxRunning) {
        console.log('[Scheduler] WebhookInbox already running, skipping this cycle.');
        return;
    }
    webhookInboxRunning = true;
    try {
        // Chamar BillingFacet.processWebhookInbox() ou serviço equivalente
        await WebhookInboxProcessor.processPending();
    } catch (err) {
        console.error('[Scheduler] WebhookInbox error:', err);
    } finally {
        webhookInboxRunning = false;
    }
});
```

---

### `prisma/schema.prisma` (model, CRUD)
**Req:** CORE-05/06 — adicionar modelos `Contributor` e `PendingContribution`; CORE-01/SEC-06 — verificações

**Analog:** `model EventLog` (linhas 406-441) e `model BlindContactLog` (linhas 476-490) — mesmo padrão de `tenantId` + relação `Tenant` + `@@index([tenantId])`

**Padrão de modelo com tenant isolation** (EventLog, linhas 406-441):
```prisma
model EventLog {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // ...campos...
  createdAt DateTime @default(now())

  @@index([tenantId])
  @@index([status])
  @@index([createdAt])
}
```

**Modelos a adicionar** (baseados no padrão acima + spec):
```prisma
// --- CURATION LAYER (Phase 1: CORE-05, CORE-06) ----------

model Contributor {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ownerRef  String   // phone, email, or any identifier
  isAuditor Boolean  @default(false)
  createdAt DateTime @default(now())

  @@unique([tenantId, ownerRef])
  @@index([tenantId])
}

model PendingContribution {
  id         String                    @id @default(cuid())
  tenantId   String
  tenant     Tenant                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ownerId    String                    // phone or email of contributor
  assetId    String?
  payload    Json
  status     PendingContributionStatus @default(PENDING_APPROVAL)
  reviewedBy String?
  reviewedAt DateTime?
  createdAt  DateTime                  @default(now())

  @@index([tenantId, status])
  @@index([createdAt])
}

enum PendingContributionStatus {
  PENDING_APPROVAL
  APPROVED
  REJECTED
}
```

**Relações a adicionar no model Tenant** (após linha 58, antes de `@@index`):
```prisma
  contributors         Contributor[]
  pendingContributions PendingContribution[]
```

**Padrão de enum existente a seguir** (buscar `enum` no schema — ex: `PlanTier`, `ApiKeyRole`):
```prisma
// Enums ficam agrupados no final do arquivo, após os modelos.
// Colocar PendingContributionStatus junto com os demais enums.
```

---

### `src/services/core-facets/LifecycleFacet.ts` (service, CRUD)
**Req:** CORE-01 — verificar `TRANSITION_RULES` para estados terminais

**Analog:** self — linhas 16-20

**Padrão de TRANSITION_RULES** (linhas 16-20):
```typescript
// Estado atual — ARCHIVED não está como terminal (ausente da tabela = sem saída)
const TRANSITION_RULES: Record<string, { targets: string[]; roles: string[] }> = {
    DRAFT:    { targets: ['ACTIVE'],                          roles: ['ADMIN', 'OPERATOR'] },
    ACTIVE:   { targets: ['SUSPENDED', 'ARCHIVED', 'BURNED'], roles: ['ADMIN'] },
    SUSPENDED:{ targets: ['ACTIVE'],                          roles: ['ADMIN'] },
    // ARCHIVED: ausente → nenhuma transição possível (terminal correto)
    // BURNED: ausente → nenhuma transição possível (terminal correto)
    // AWAITING_PAYMENT → ACTIVE: controlado por BillingFacet (não aqui)
};
```

**Diagnóstico:** A ausência de `ARCHIVED` e `BURNED` no mapa é o comportamento correto para estados terminais. O `LifecycleFacet` já rejeita essas transições com `STATE_TRANSITION_FORBIDDEN`. Nenhuma mudança necessária — apenas verificar e documentar.

---

### `src/services/core-facets/AlgorandAnchorFacet.ts` (service, CRUD)
**Req:** SEC-06 — verificar se `tenantId` é populado ao criar `ChainTransaction`

**Analog:** `src/services/AnchorQueueService.ts` — linhas 47-52 (padrão de tenantId scoping)

**Padrão existente de tenantId no AnchorQueueService** (linhas 47-52):
```typescript
// tenantId já está disponível nos eventos processados:
const uniqueTenantIds = [...new Set(lockedEvents.map(e => e.tenantId))];
const tenants = await prisma.tenant.findMany({
    where: { id: { in: uniqueTenantIds } },
    select: { id: true, targetChain: true },
});
```

**Padrão de criação de ChainTransaction** (schema, linhas 731-767) — campo obrigatório:
```prisma
// ChainTransaction.tenantId é String (não nullable) — deve ser sempre populado
model ChainTransaction {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // ...
}
```

**Verificação necessária no AlgorandAnchorFacet:** Confirmar que o `prisma.chainTransaction.create()` inclui `tenantId`. Se ausente, adicionar passando `event.tenantId` recebido do `AnchorQueueService`.

---

## Shared Patterns

### Autenticação (API Key + RBAC)
**Source:** `src/middleware/apiKeyAuth.ts` + `src/middleware/rbacGuard.ts`
**Apply to:** Todas as novas rotas autenticadas (`PATCH /assets/:id/transfer`, `POST /contributions/:id/review`)

```typescript
// Middleware chain padrão para rota autenticada com RBAC mínimo OPERATOR:
router.patch('/:id/transfer',
    requireApiKey,          // injeta req.tenantId, req.apiKeyId, req.apiKeyRole
    requireIdempotency,     // verifica X-Idempotency-Key
    tenantRateLimiter,      // rate limit por tenant/plano
    requireOperator,        // ADMIN ou OPERATOR
    handler
);

// Para rota de review de contribuição (OPERATOR):
router.post('/contributions/:id/review',
    requireApiKey,
    tenantRateLimiter,
    requireOperator,
    handler
);
```

### Tenant Isolation em Facets
**Source:** `src/services/core-facets/LifecycleFacet.ts` linhas 34-42 e `src/services/core-facets/TransferRegistryFacet.ts` linhas 31-38
**Apply to:** `CurationFacet.reviewContribution()`, qualquer query no `CurationFacet`

```typescript
// Padrão universal: nunca confiar em tenantId do payload — sempre do secureContext:
const asset = await prisma.asset.findUnique({
    where: { id: assetId, tenantId },   // tenantId do secureContext, não do req.body
});
if (!asset) {
    throw makeError('Asset not found or access denied', 'ASSET_NOT_FOUND', 404);
}
```

### Error Handling nos Facets
**Source:** `src/services/core-facets/LifecycleFacet.ts` linhas 22-26 e `src/services/core-facets/TransferRegistryFacet.ts` linhas 25-28
**Apply to:** `CurationFacet`, qualquer novo Facet

```typescript
// Padrão 1 — makeError com httpStatus (LifecycleFacet):
function makeError(message: string, code: string, httpStatus: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.httpStatus = httpStatus;
    return err;
}

// Padrão 2 — error inline sem httpStatus (TransferRegistryFacet):
const err: any = new Error('Asset not found or access denied');
err.code = 'ASSET_NOT_FOUND';
throw err;
```

### Fire-and-Forget AnchorQueue
**Source:** `src/services/core-facets/EventLogFacet.ts` linhas 83-84
**Apply to:** `CurationFacet.submitContribution()` (branch auditor) e `CurationFacet.reviewContribution()` (decision APPROVED)

```typescript
// Fire-and-forget — nunca await para não bloquear a resposta HTTP:
AnchorQueueService.processQueue().catch(console.error);
```

### Resposta HTTP Padronizada
**Source:** `src/controllers/BlindContactController.ts` linhas 17-25 e `src/routes/v1/circuitBreakerRoutes.ts` linhas 32-36
**Apply to:** Todo novo controller e handler de rota

```typescript
// Padrão de sucesso — objeto ApiResponse:
return res.status(201).json({
    success: true,
    data: { ... },
    meta: {
        timestamp: new Date().toISOString(),
        facet: 'CURATION'
    }
});

// Padrão de erro no handler inline:
res.json({ success: true, data: result });
// ou
res.status(500).json({ success: false, error: err.message });
```

### Cron Job com isRunning Guard
**Source:** `src/services/SchedulerService.ts` linhas 18-34
**Apply to:** Qualquer novo job no SchedulerService (ex: WebhookInbox processor)

```typescript
let isRunning = false;
cron.schedule(pattern, async () => {
    if (isRunning) { console.log('[Scheduler] already running, skipping.'); return; }
    isRunning = true;
    try { await Worker.process(); }
    catch (err) { console.error('[Scheduler] error:', err); }
    finally { isRunning = false; }
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/controllers/TransferController.ts` | controller | request-response | Não existe controller para TransferRegistryFacet — usar BlindContactController como template slim |

---

## Metadata

**Analog search scope:** `src/services/`, `src/services/core-facets/`, `src/routes/v1/`, `src/middleware/`, `src/utils/`, `src/diamond/`, `prisma/`
**Files scanned:** 16
**Pattern extraction date:** 2026-05-08
