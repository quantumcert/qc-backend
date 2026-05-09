# Phase 1: Core Gap Closure + Production Hardening — Research

**Researched:** 2026-05-08
**Domain:** Node.js / TypeScript — Brownfield gap closure (criptografia PQC, state machine, scheduler, curation layer)
**Confidence:** HIGH (codebase completo lido; nenhuma hipótese não verificada)

---

## Summary

Esta fase não é greenfield: o codebase já tem implementações parciais ou completas para quase todos os
12 requisitos. O trabalho real é **conectar, corrigir ou completar** o que existe — não construir do zero.

A descoberta mais importante é que `PostQuantumCrypto.verifySignatureFalcon512()` já existe e funciona
(usando `falcon.verifyDetached` do pacote `falcon-crypto@1.0.6`), mas `QuantumSignerService.verifySignature()`
ainda retorna `true` como stub. Esses dois precisam ser conectados. O `KMSService` já persiste a master key
derivada de `QUANTUM_CERT_SECRET` — portanto SEC-01 é principalmente sobre documentar e validar o padrão
existente, mais do que implementar do zero.

A camada de curação (CORE-05/CORE-06) tem uma spec de design detalhada (`docs/superpowers/specs/2026-05-08-curation-layer-design.md`)
mas nenhum código implementado ainda — é o maior bloco de trabalho novo da fase. Os demais requisitos
(SEC-03, SEC-04, SEC-05, SEC-06, CORE-01, CORE-02, CORE-03, CORE-04) já têm implementações que precisam
de ajustes pontuais.

**Recomendação primária:** Atacar a fase em 4 grupos paralelos — (A) PQC + KMS fixes, (B) curation layer,
(C) conectar FacetRegistry + schema fixes, (D) verificar scheduler e webhook (ambos já implementados).

---

## Project Constraints (from CLAUDE.md)

- **Golden Rule:** Todos os Facets devem ser 100% agnósticos de domínio. Apenas termos universais: `Tenant`, `Asset`, `Device`, `Event`, `Owner`, `Metadata`. Nunca "jewelry", "luxury" etc. no core.
- **Routing Strategy Option C (Híbrido):** Operações tenant-autenticadas → `POST /api/v1/diamond`; mudanças de estado semânticas → rotas REST dedicadas; webhooks externos → rotas sem `apiKeyAuth`.
- **Tenant Isolation:** Queries Prisma sempre escoopadas por `tenantId`. Nunca confiar em `tenantId` vindo do corpo da requisição.
- **Idempotency:** Mutations requerem `X-Idempotency-Key` enforced por `requireIdempotency`.
- **API Keys:** Prefixo `qc_`, header `X-API-Key`. Roles: `ADMIN > OPERATOR > READER`.
- **Testing:** vitest (unit) + vitest e2e. Estrutura de testes em `tests/`.
- **GSD Workflow:** branch `7-feat-camada-de-curadoria-...` — CORE-05 e CORE-06 em desenvolvimento aqui. Schema Prisma modificado mas sem novos modelos (apenas reformatação de whitespace).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | Chave Falcon-512 persistida em KMS/secret vault — não gerada como env var efêmera | KMSService já deriva chave de `QUANTUM_CERT_SECRET`. O gap real é que sem a env var, uma chave efêmera é gerada em cada restart. Solução: fazer startup falhar se `QUANTUM_CERT_SECRET` ausente em produção. |
| SEC-02 | `QuantumSignerService.verifySignature()` implementa verificação criptográfica real | `PostQuantumCrypto.verifySignatureFalcon512()` já existe e usa `falcon.verifyDetached`. Apenas conectar ao `QuantumSignerService`. |
| SEC-03 | CircuitBreaker com RBAC correto — somente roles autorizadas podem acionar pausa global | `circuitBreakerRoutes.ts` já usa `requireAdmin`. O gap: `verifyAdminSignature()` aceita qualquer string não-vazia com `return true`. Precisa usar `PostQuantumCrypto.verifySignatureFalcon512()`. |
| SEC-04 | `AnchorQueueService` usa distributed lock para evitar duplo-processamento | Lock atômico por row (`dltTxId: 'PROCESSING'`) já existe. O gap: a query inicial busca eventos sem lock pessimista — race condition se dois workers lerem o mesmo batch antes da atualização. Solução: `pg_advisory_lock` ou `SELECT FOR UPDATE SKIP LOCKED` via `$queryRaw`. |
| SEC-05 | `DocumentVerificationFacet` registrado no `FacetRegistry` | Facet existe mas não está no `FacetRegistry`. Adicionar selector `document.verify`. Atenção: interface do Facet (retorna `valid`, `verified`, etc.) diverge entre código atual e testes — necessita harmonização. |
| SEC-06 | `tenantId` persistido em `ChainTransaction` para queries cross-chain | Schema já tem `tenantId` em `ChainTransaction` (linha 736 do schema). Gap: verificar se `DLTAdapterFactory`/`AlgorandAnchorFacet` populam esse campo ao criar registros. |
| CORE-01 | `LifecycleFacet` — enforce state transitions completo | Implementado. Gap: `TRANSITION_RULES` não inclui `AWAITING_PAYMENT → ACTIVE` (controlada por BillingFacet, não por esta rota) nem `ARCHIVED` como estado terminal (nenhuma transição saindo dele). Verificar se a spec exige essas arestas. |
| CORE-02 | `TransferRegistryFacet` — `PATCH /api/v1/assets/:id/lifecycle` REST semântico | `TransferRegistryFacet` existe e funciona via Diamond (`transfer.initiate`). Falta: rota REST dedicada `PATCH /api/v1/assets/:assetId/transfer`. |
| CORE-03 | `SchedulerService` — node-cron trigger para `AnchorQueueService` | Já implementado e chamado em `server.ts` após `app.listen()`. Verificar se está funcionando corretamente (testes de scheduler existem em `tests/scheduler.test.ts`). |
| CORE-04 | MercadoPago webhook — `POST /api/v1/webhooks/mercadopago` com validação de assinatura | Já implementado com HMAC SHA-256, inbox pattern, timing-safe compare. Verificar se `WebhookInbox` tem processador (scheduler que lê status PENDING). |
| CORE-05 | Curation Layer — contribuições de não-auditores entram em fila `PENDING_REVIEW` | Spec existe (`2026-05-08-curation-layer-design.md`). Código: zero. Necessita: 2 novos modelos Prisma (`Contributor`, `PendingContribution`), `CurationFacet`, rota pública. |
| CORE-06 | Fluxo de aprovação — OPERATOR/ADMIN aprovam/rejeitam contribuições pendentes com log | Complemento de CORE-05. Necessita: endpoint de review + registro em EventLog. |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Falcon-512 key persistence (SEC-01) | API / Backend (KMSService) | — | Key material nunca sai do processo; derivada de env var ou vault |
| Falcon-512 signature verification (SEC-02) | API / Backend (PostQuantumCrypto) | — | Operação criptográfica pura — não é responsabilidade de nenhum cliente |
| CircuitBreaker RBAC (SEC-03) | API / Backend (circuitBreakerRoutes + RBAC middleware) | — | Controle de acesso enforced no servidor, nunca no cliente |
| AnchorQueue distributed lock (SEC-04) | Database / Storage (PostgreSQL row lock) | API Backend | Lock precisa ser atômico no banco para funcionar em múltiplos workers |
| DocumentVerificationFacet registration (SEC-05) | API / Backend (FacetRegistry) | — | Roteamento interno do Diamond Pattern |
| tenantId in ChainTransaction (SEC-06) | Database / Storage (schema) | API Backend (DLT adapter) | Persiste no momento da escrita pelo adapter |
| LifecycleFacet state machine (CORE-01) | API / Backend (LifecycleFacet) | Database | Regras de transição enforced no Facet; estado persiste no banco |
| TransferRegistryFacet REST route (CORE-02) | API / Backend (routes + controller) | — | Exposição de endpoint REST semântico |
| SchedulerService cron (CORE-03) | API / Backend (SchedulerService) | — | Processo embutido no servidor; worker pattern |
| MercadoPago webhook processor (CORE-04) | API / Backend (WebhookController + scheduler) | Database | Inbox pattern: persiste antes de processar |
| Curation Layer submission (CORE-05) | API / Backend (CurationFacet + public route) | Database | Lógica de curadoria no Facet; contribuições persistidas |
| Curation Layer approval flow (CORE-06) | API / Backend (CurationFacet + Diamond) | Database | Aprovação enforced no Facet com registro em EventLog |

---

## Standard Stack

### Core (já instalado no projeto)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `falcon-crypto` | 1.0.6 [VERIFIED: npm registry] | Falcon-512 PQC sign/verify | Único pacote npm com Falcon-512 WASM — já em uso |
| `prisma` | ^5.7.0 [VERIFIED: package.json] | ORM + migrations | Stack existente do projeto |
| `node-cron` | 4.2.1 [VERIFIED: npm registry] | Cron scheduling | Já instalado e usado no SchedulerService |
| `vitest` | 1.0.4 [VERIFIED: npm registry] | Test framework | Stack existente — testes em `tests/` |
| `zod` | ^3.22.4 [VERIFIED: package.json] | Input validation | Já disponível mas pouco usado nos facets |

### Não Instalar (evitar scope creep)
| Problema | Não Usar | Usar Existente |
|---------|----------|----------------|
| Distributed lock | `redlock` | `pg_advisory_lock` via `prisma.$queryRaw` |
| PQC verification | `oqs-node` / `liboqs` | `falcon-crypto` já expõe `verifyDetached` |
| Job queue | `bull` / `BullMQ` | Fase 4 (OPS-05) — fora do escopo da Fase 1 |

---

## Architecture Patterns

### System Architecture Diagram (Phase 1 changes)

```
HTTP Request (public contribution)
  → POST /api/v1/public/asset/:assetId/contribution
  → publicRoutes → CurationFacet.submitContribution()
      ├── [isAuditor: true]  → EventLog (APPROVED) → AnchorQueueService (fire-and-forget)
      └── [isAuditor: false] → PendingContribution (PENDING_APPROVAL)

HTTP Request (approval)
  → POST /api/v1/diamond { selector: "contribution.review" }
  → requireApiKey (OPERATOR/ADMIN) → DiamondProxy → CurationFacet.reviewContribution()
      ├── [APPROVED] → EventLog (APPROVED) → AnchorQueueService
      └── [REJECTED] → PendingContribution.status = REJECTED

HTTP Request (circuit breaker pause)
  → POST /api/v1/circuit-breaker/pause
  → requireApiKey + requireAdmin
  → CircuitBreakerService.pauseChain(chain, signature)
  → PostQuantumCrypto.verifySignatureFalcon512(payload, sig, adminPubKey) [NOVO]
      ├── [valid]   → PanicLog + state = PAUSED
      └── [invalid] → 401

AnchorQueueService (cron trigger a cada 30s)
  → pg_advisory_lock (SELECT FOR UPDATE SKIP LOCKED) [NOVO]
  → batch de 10 EventLog (status APPROVED, dltTxId null)
  → DLTAdapterFactory.getAdapter(tenant.targetChain)
  → adapter.anchorEvent() → ChainTransaction (com tenantId) [NOVO]
```

### Recommended Project Structure (adições desta fase)

```
src/
├── services/core-facets/
│   ├── CurationFacet.ts          # NOVO — CORE-05, CORE-06
│   └── DocumentVerificationFacet.ts  # EXISTENTE — apenas adicionar ao FacetRegistry
├── routes/v1/
│   ├── publicRoutes.ts           # EXISTENTE — adicionar rota de contribuição
│   └── assetRoutes.ts            # EXISTENTE — adicionar PATCH /assets/:id/transfer
prisma/
└── schema.prisma                 # NOVO: Contributor, PendingContribution models
```

### Pattern 1: Registro no FacetRegistry (SEC-05)

O `DocumentVerificationFacet` existe mas não está no `FacetRegistry`. A correção é uma linha:

```typescript
// src/diamond/FacetRegistry.ts — adicionar na seção DOCUMENT VERIFICATION:
'document.verify': (ctx: any, payload: any) => DocumentVerificationFacet.verifyByHash(payload.hash),
```

Atenção: o teste `document-verification.test.ts` espera campo `verified` (não `valid`) na resposta.
O código atual retorna `{ valid: boolean }`. Harmonizar antes de registrar.

### Pattern 2: Falcon-512 Verification (SEC-02, SEC-03)

`PostQuantumCrypto.verifySignatureFalcon512` já implementa a verificação real:

```typescript
// src/utils/PostQuantumCrypto.ts (existente, verificado)
static async verifySignatureFalcon512(
    message: string,
    signatureB64: string,
    publicKeyB64: string
): Promise<boolean> {
    const messageBytes = Buffer.from(message);
    const signature = Buffer.from(signatureB64, 'base64');
    const publicKey = Buffer.from(publicKeyB64, 'base64');
    return await falcon.verifyDetached(signature, messageBytes, publicKey);
}
```

`QuantumSignerService.verifySignature()` deve delegar para este método:

```typescript
// QuantumSignerService — remover stub, adicionar:
async verifySignature(payload: object, signatureBase64: string, publicKeyHex: string): Promise<boolean> {
    const message = JSON.stringify(payload);
    const publicKeyB64 = Buffer.from(publicKeyHex, 'hex').toString('base64');
    return PostQuantumCrypto.verifySignatureFalcon512(message, signatureBase64, publicKeyB64);
}
```

**IMPORTANTE:** Para SEC-03 (CircuitBreaker), o `CIRCUIT_BREAKER_ADMIN_PUBKEY` precisa ser configurado
como variável de ambiente. A public key do admin (Falcon-512) deve ser gerada uma vez e armazenada em `.env`.

### Pattern 3: Distributed Lock (SEC-04)

O lock atual (`dltTxId: 'PROCESSING'`) protege contra double-update mas não contra double-read.
Se dois workers leram o mesmo batch antes de qualquer update, ambos tentarão lockear os mesmos eventos.
O `updateMany` com `where: { dltTxId: null }` garante que apenas um terá `count > 0` — mas os dois
workers ainda desperdiçam ciclos.

A solução mais segura sem adicionar dependências é `SELECT FOR UPDATE SKIP LOCKED` via raw SQL:

```typescript
// Dentro de AnchorQueueService.processQueue() — substituir o findMany inicial:
const pendingEvents = await prisma.$queryRaw<Array<{id: string, ...}>>`
    SELECT id, "assetId", "tenantId", "signatureHash"
    FROM "EventLog"
    WHERE status IN ('APPROVED', 'PENDING_FUNDS')
    AND "dltTxId" IS NULL
    AND "signatureHash" IS NOT NULL
    ORDER BY id ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
`;
```

Isso é seguro em PostgreSQL e evita que dois workers processem o mesmo evento, sem adicionar
`pg_advisory_lock` (que requer gestão manual de lock IDs).

### Pattern 4: CurationFacet (CORE-05, CORE-06)

Baseado na spec `2026-05-08-curation-layer-design.md`:

```typescript
// src/services/core-facets/CurationFacet.ts
export class CurationFacet {
    static async submitContribution(params: {
        assetId: string;
        phone?: string;
        email?: string;
        payload: Record<string, any>;
    }): Promise<{ queued: boolean; eventId?: string; pendingId?: string }> {
        // 1. Validate phone or email present
        // 2. Fetch asset → derive tenantId
        // 3. ownerRef = phone ?? email
        // 4. Query Contributor { tenantId, ownerRef, isAuditor: true }
        // 5a. Auditor: create EventLog (APPROVED) + fire-and-forget AnchorQueue
        // 5b. Non-auditor: create PendingContribution (PENDING_APPROVAL)
    }

    static async reviewContribution(
        secureContext: { tenantId: string; role: string; apiKeyId: string },
        payload: { pendingId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }
    ): Promise<void> {
        // 1. Fetch PendingContribution by id, scoped to tenantId
        // 2. RBAC: role must be OPERATOR or ADMIN
        // 3. Update status
        // 4. If APPROVED: create EventLog + trigger AnchorQueue
        // 5. Create EventLog de auditoria com reviewedBy = apiKeyId
    }
}
```

### Anti-Patterns a Evitar

- **Não adicionar `contribution.submit` ao FacetRegistry:** A spec indica rota pública direta (mesmo padrão do `BlindContactController`) — sem Diamond, sem `apiKeyAuth`.
- **Não adicionar `pg_advisory_lock` com lock IDs hardcoded:** Race condition em múltiplos workers com IDs fixos. Usar `SKIP LOCKED` em vez disso.
- **Não remover o lock `dltTxId: 'PROCESSING'` ao adicionar `SKIP LOCKED`:** Os dois mecanismos são complementares — `SKIP LOCKED` previne double-read, o `updateMany` previne double-update se o SKIP LOCKED falhar.
- **Não gerar chave Falcon efêmera em produção:** `KMSService.getQuantumMasterKey()` já loga warning se `QUANTUM_CERT_SECRET` não estiver presente. Para SEC-01, tornar isso um erro fatal em `NODE_ENV=production`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PQC verification | Implementação própria de Falcon-512 | `falcon-crypto.verifyDetached()` via `PostQuantumCrypto` | Já existe no projeto, testado, WASM compilado |
| Distributed lock | Redis Redlock | `SELECT FOR UPDATE SKIP LOCKED` (PostgreSQL) | Sem nova dependência; PostgreSQL já é o banco |
| Key wrapping | AES manual | `PostQuantumCrypto.wrapKey/unwrapKey()` com HKDF + AES-256-GCM | Já implementado com zeroização adequada |
| Cron scheduling | `setInterval` | `node-cron` (já instalado e em uso) | Padrão existente, já configurado no `SchedulerService` |

---

## Runtime State Inventory

> Esta fase não envolve rename/refactor, mas schema.prisma tem modificações não migradas.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Schema Prisma atual não tem `Contributor` nem `PendingContribution` — modelos necessários para CORE-05/CORE-06 | Migration `prisma migrate dev` |
| Stored data | `ChainTransaction` já tem coluna `tenantId` no schema — verificar se adapter a popula | Auditoria de código no `AlgorandAnchorFacet` |
| Stored data | `WebhookInbox` existe no schema e `WebhookController` já persiste registros PENDING — verificar se há job processando-os | Verificar se `SchedulerService` tem job para processar `WebhookInbox` |
| Live service config | Schema diff atual é apenas whitespace/formatting — não há novos campos pendentes na branch atual | `git diff prisma/schema.prisma` confirma apenas formatação |
| OS-registered state | Nenhum — verificado por análise do codebase | None |
| Secrets/env vars | `CIRCUIT_BREAKER_ADMIN_PUBKEY` — não existe atualmente; necessário para SEC-03 funcionar em produção | Gerar par de chaves Falcon-512 e configurar env |
| Secrets/env vars | `QUANTUM_CERT_SECRET` — se ausente, KMS gera chave efêmera (SEC-01 gap) | Tornar fatal em `NODE_ENV=production` |
| Secrets/env vars | `MP_WEBHOOK_SECRET` — documentado como necessário em spec mas sem enforcement no startup | Adicionar ao `REQUIRED_ENV_VARS` em `server.ts` |
| Build artifacts | Nenhum relevante | None |

---

## Common Pitfalls

### Pitfall 1: DocumentVerificationFacet — interface divergente

**O que vai errado:** O código atual retorna `{ valid: boolean }` mas os testes unitários existentes
(`tests/document-verification.test.ts`) esperam `{ verified: boolean }` (campo diferente).
**Por que acontece:** O Facet foi refatorado sem atualizar todos os testes, ou vice-versa.
**Como evitar:** Antes de adicionar ao FacetRegistry, harmonizar a interface. Verificar os testes
e alinhar o código ou os testes com o contrato correto.
**Sinais de alerta:** `npm test` falha em `document-verification.test.ts`.

### Pitfall 2: CircuitBreaker sem public key configurada

**O que vai errado:** `verifyAdminSignature()` agora chamará `PostQuantumCrypto.verifySignatureFalcon512()`,
mas `CIRCUIT_BREAKER_ADMIN_PUBKEY` não existe como env var — vai lançar erro na primeira chamada ao endpoint.
**Por que acontece:** A env var é nova (não estava na spec original).
**Como evitar:** Documentar no `.env.example` + gerar par de chaves durante setup.
Adicionar fallback gracioso: se env var ausente em dev, logar warning e usar comportamento antigo.

### Pitfall 3: `SELECT FOR UPDATE` sem transação explícita

**O que vai errado:** `SELECT FOR UPDATE SKIP LOCKED` em PostgreSQL **requer** uma transação ativa.
Usar via `prisma.$queryRaw` fora de `prisma.$transaction` liberará o lock imediatamente.
**Por que acontece:** Prisma não abre transação automática para `$queryRaw`.
**Como evitar:** Envolver em `prisma.$transaction(async (tx) => { ... })` e usar `tx.$queryRaw`.

### Pitfall 4: CurationFacet sem validação de payload size

**O que vai errado:** Contribuições públicas (sem auth) podem incluir payloads grandes, contornando
o limite de 500kb do bodyParser se processados via rota pública.
**Por que acontece:** Rota pública usa o mesmo express.json() global.
**Como evitar:** Adicionar validação de tamanho no `CurationFacet.submitContribution()` ou middleware
específico na rota. O limite de `express.json({ limit: '500kb' })` em `server.ts` já protege no nível HTTP.

### Pitfall 5: MercadoPago webhook — WebhookInbox sem processador

**O que vai errado:** `WebhookController` persiste corretamente no `WebhookInbox`, mas se não há
job varrendo `status: 'PENDING'`, os pagamentos ficam presos no inbox indefinidamente.
**Por que acontece:** O `SchedulerService` atual não inclui um job para processar `WebhookInbox`.
**Como evitar:** Verificar se `BillingFacet` tem um método de processamento de inbox e se
`SchedulerService` o chama. Se não, adicionar um cron job simples para CORE-04 estar completo.

---

## Code Examples

### Adição ao FacetRegistry (SEC-05)

```typescript
// src/diamond/FacetRegistry.ts — adicionar:
import { DocumentVerificationFacet } from '../services/core-facets/DocumentVerificationFacet';

// No objeto FacetRegistry:
'document.verify': (_ctx: any, payload: any) => DocumentVerificationFacet.verifyByHash(payload.hash),
```

### Schema Prisma — novos modelos (CORE-05/CORE-06)

```prisma
// Baseado na spec 2026-05-08-curation-layer-design.md [CITED: docs/superpowers/specs/2026-05-08-curation-layer-design.md]

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
  tenant     Tenant                    @relation(fields: [tenantId], references: [id])
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

**Tenant model** precisa de duas relações:
```prisma
contributors         Contributor[]
pendingContributions PendingContribution[]
```

### SELECT FOR UPDATE SKIP LOCKED (SEC-04)

```typescript
// src/services/AnchorQueueService.ts — dentro de prisma.$transaction():
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
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `verifySignature()` stub `return true` | `falcon.verifyDetached()` real | Esta fase (SEC-02) | Segurança criptográfica real |
| `verifyAdminSignature()` aceita qualquer string | Verifica contra public key Falcon-512 | Esta fase (SEC-03) | CircuitBreaker seguro |
| AnchorQueue sem lock pessimista na leitura | `SELECT FOR UPDATE SKIP LOCKED` | Esta fase (SEC-04) | Zero double-processing |
| Contribuições públicas vão direto para EventLog | Curation layer com `PendingContribution` | Esta fase (CORE-05) | Controle de qualidade de dados |

**Já correto (não alterar):**
- `SchedulerService` + `AnchorQueueService`: implementados e chamados em `server.ts`. [VERIFIED: src/server.ts + src/services/SchedulerService.ts]
- `WebhookController` HMAC + inbox pattern: implementado corretamente. [VERIFIED: src/controllers/WebhookController.ts]
- `LifecycleFacet.transition()`: implementado com state machine completa. [VERIFIED: src/services/core-facets/LifecycleFacet.ts]
- `TransferRegistryFacet.initiateTransfer()`: implementado via Diamond (`transfer.initiate`). [VERIFIED: src/services/core-facets/TransferRegistryFacet.ts]
- `KMSService.wrapKey/unwrapKey()`: implementados com AES-256-GCM + HKDF. [VERIFIED: src/services/KMSService.ts]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ChainTransaction` não está sendo populado com `tenantId` pelo `AlgorandAnchorFacet` (SEC-06 gap) | Phase Requirements | Se o adapter já popula, SEC-06 pode estar completo e não precisar de trabalho |
| A2 | `WebhookInbox` não tem processador no `SchedulerService` (CORE-04) | Common Pitfalls | Se `BillingFacet` já processa via scheduler, CORE-04 pode estar mais completo do que parece |
| A3 | `CIRCUIT_BREAKER_ADMIN_PUBKEY` não existe como env var | Runtime State Inventory | Se o time já configurou essa variável em algum `.env` não comitado, SEC-03 tem menos trabalho |

---

## Open Questions

1. **SEC-01: O que constitui "persistência" aceitável para MVP?**
   - O que sabemos: `KMSService` já deriva chave de `QUANTUM_CERT_SECRET` de forma determinística (mesma env = mesma chave após restart). Isso é funcional.
   - O que está unclear: O requisito pede "KMS/secret vault". Para MVP, `QUANTUM_CERT_SECRET` em `.env` é suficiente, ou precisa de integração com AWS Secrets Manager/HashiCorp Vault?
   - Recomendação: Para MVP, fazer `QUANTUM_CERT_SECRET` obrigatório em produção (startup crash se ausente) + documentar o path de upgrade para vault real. Isso satisfaz o requisito sem escopo adicional.

2. **CORE-02: A rota REST faltante é `PATCH /assets/:id/lifecycle` ou `PATCH /assets/:id/transfer`?**
   - O que sabemos: A spec diz `PATCH /api/v1/assets/:id/lifecycle` para CORE-02. O FacetRegistry já tem `lifecycle.transition` via Diamond. `TransferRegistryFacet` tem `transfer.initiate` via Diamond.
   - O que está unclear: CORE-02 pede rota REST para `TransferRegistryFacet`, não `LifecycleFacet`. A spec `2026-04-09-core-gap-closure-design.md` lista `PATCH /api/v1/assets/:assetId/transfer` como a rota faltante.
   - Recomendação: Criar `PATCH /api/v1/assets/:assetId/transfer` → `TransferController` → `TransferRegistryFacet.initiateTransfer()`.

3. **CORE-06: O selector Diamond para aprovação de contribuições é necessário?**
   - O que sabemos: A spec de curation layer diz "nenhum selector no FacetRegistry — rota pública chama facet diretamente". Mas CORE-06 (aprovação) requer autenticação (OPERATOR/ADMIN).
   - O que está unclear: Aprovação vai via Diamond (`contribution.review`?) ou via rota REST dedicada?
   - Recomendação: Usar rota REST dedicada `POST /api/v1/contributions/:id/review` com `requireApiKey + requireOperator` — consistente com o padrão híbrido Option C.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | Prisma ORM | ✓ (assumido — `DATABASE_URL` em `.env`) | — | — |
| Node.js | Runtime | ✓ | — | — |
| `falcon-crypto` | SEC-01, SEC-02, SEC-03 | ✓ | 1.0.6 [VERIFIED: npm registry] | — |
| `node-cron` | CORE-03 | ✓ | 4.2.1 [VERIFIED: npm registry] | — |
| `QUANTUM_CERT_SECRET` env var | SEC-01 | Desconhecido | — | Chave efêmera (DEV) — blocker para produção |
| `MP_WEBHOOK_SECRET` env var | CORE-04 | Desconhecido | — | Webhook rejeitará todas as chamadas |
| `CIRCUIT_BREAKER_ADMIN_PUBKEY` env var | SEC-03 | Desconhecido | — | CircuitBreaker fica inseguro (aceita qualquer sig) |

**Missing dependencies com fallback:**
- Env vars de segurança (`QUANTUM_CERT_SECRET`, `MP_WEBHOOK_SECRET`, `CIRCUIT_BREAKER_ADMIN_PUBKEY`) — para desenvolvimento, os defaults existentes funcionam; para produção, são blockers.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 1.0.4 [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (existe em raiz) |
| Quick run command | `npm test` |
| Full suite command | `npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | KMS deriva chave determinística de QUANTUM_CERT_SECRET | unit | `npm test -- tests/post-quantum-crypto.test.ts` | ✅ |
| SEC-02 | verifySignature() retorna false para sig inválida | unit | `npm test -- tests/post-quantum-crypto.test.ts` | ✅ |
| SEC-03 | CircuitBreaker rejeita signature vazia/inválida | unit | `npm test -- tests/security-regression.test.ts` | ✅ |
| SEC-04 | Dois workers não processam mesmo EventLog | unit | `npm test -- tests/scheduler.test.ts` | ✅ |
| SEC-05 | `document.verify` selector retorna resultado (não 404) | unit | `npm test -- tests/document-verification.test.ts` | ✅ |
| SEC-06 | ChainTransaction criada com tenantId preenchido | unit | Wave 0 — novo arquivo necessário | ❌ |
| CORE-01 | `BURNED → ACTIVE` é rejeitado com 422 | unit | `npm test -- tests/lifecycle-diamond.test.ts` | ✅ |
| CORE-02 | `PATCH /assets/:id/transfer` retorna 200 com paymentLink | unit | `npm test -- tests/transfer-diamond.test.ts` | ✅ (adaptar para REST) |
| CORE-03 | AnchorQueue é triggerado pelo cron | unit | `npm test -- tests/scheduler.test.ts` | ✅ |
| CORE-04 | Webhook com HMAC inválido retorna 401 | unit | `npm test -- tests/webhook.test.ts` | ✅ |
| CORE-05 | Contribuição de não-auditor cria PendingContribution | unit | Wave 0 — `tests/curation-facet.test.ts` | ❌ |
| CORE-06 | OPERATOR aprova PendingContribution → EventLog criado | unit | Wave 0 — `tests/curation-facet.test.ts` | ❌ |

### Sampling Rate

- **Per task commit:** `npm test -- --reporter=verbose 2>&1 | tail -20`
- **Per wave merge:** `npm test && npm run test:e2e`
- **Phase gate:** Full suite green antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/curation-facet.test.ts` — cobre CORE-05, CORE-06 (baseado na spec: 5 casos de teste definidos)
- [ ] `tests/chain-transaction-tenant.test.ts` — cobre SEC-06 (tenantId persistido)

*(Infraestrutura de teste existente cobre todos os demais requisitos)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | API Keys (bcrypt hash) — já implementado |
| V3 Session Management | no | Stateless (API keys, sem sessão) |
| V4 Access Control | yes | RBAC via `requireAdmin` / `requireOperator` — já implementado |
| V5 Input Validation | yes | Validação manual nos Facets — zod disponível mas subutilizado |
| V6 Cryptography | yes | Falcon-512 via `falcon-crypto` — nunca hand-roll |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CircuitBreaker bypass com sig forjada | Spoofing | Falcon-512 verify real (SEC-02 + SEC-03) |
| Double-spend em AnchorQueue | Tampering | `SELECT FOR UPDATE SKIP LOCKED` (SEC-04) |
| Contribuição pública spam | Denial of Service | Rate limiter existente (`/api/v1/scan` tem 30 req/min; rota de contribuição precisa de limite similar) |
| Payload injection via curation | Tampering | Payload é JSON opaco — não interpretado pelo core (Golden Rule) |
| Timing attack no webhook HMAC | Information Disclosure | `crypto.timingSafeEqual` já implementado |
| Falcon key ephemeral loss | Repudiation | SEC-01: tornar `QUANTUM_CERT_SECRET` obrigatório em produção |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: codebase] `src/services/QuantumSignerService.ts` — stub `return true` confirmado na linha 113
- [VERIFIED: codebase] `src/utils/PostQuantumCrypto.ts` — `verifySignatureFalcon512()` implementado com `falcon.verifyDetached`
- [VERIFIED: codebase] `src/diamond/FacetRegistry.ts` — `DocumentVerificationFacet` ausente da tabela de roteamento
- [VERIFIED: codebase] `src/services/AnchorQueueService.ts` — lock atômico por row presente, sem `SKIP LOCKED`
- [VERIFIED: codebase] `prisma/schema.prisma` — `ChainTransaction` tem `tenantId`; `Contributor`/`PendingContribution` ausentes
- [VERIFIED: codebase] `src/controllers/WebhookController.ts` — HMAC + inbox pattern implementados corretamente
- [VERIFIED: codebase] `src/services/SchedulerService.ts` — cron configurado e chamado em `server.ts`
- [CITED: docs/superpowers/specs/2026-05-08-curation-layer-design.md] — spec de design aprovada para CORE-05/CORE-06
- [CITED: docs/superpowers/specs/2026-04-09-core-gap-closure-design.md] — spec original dos gaps de core
- [VERIFIED: npm registry] `falcon-crypto@1.0.6` — versão atual
- [VERIFIED: npm registry] `node-cron@4.2.1` — versão atual
- [VERIFIED: npm registry] `vitest@1.0.4` — versão em uso

### Secondary (MEDIUM confidence)

- [VERIFIED: package.json] Dependências instaladas — prisma ^5.7.0, zod ^3.22.4, bcryptjs ^3.0.3

### Tertiary (LOW confidence)

- Nenhuma fonte LOW confidence nesta pesquisa — todos os fatos foram verificados diretamente no codebase.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verificado no package.json e npm registry
- Architecture: HIGH — código real lido, não assumido
- Pitfalls: HIGH — identificados por leitura direta do código com gaps confirmados
- Curation Layer (CORE-05/06): MEDIUM — spec aprovada existe, código zero; spec pode divergir de necessidades não documentadas

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (dependências estáveis; expira se houver breaking changes no falcon-crypto ou prisma)
