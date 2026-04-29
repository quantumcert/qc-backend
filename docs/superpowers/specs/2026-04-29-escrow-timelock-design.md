# Sub-sistema 5 — EscrowFacet + Time-Lock Oracle + Diamond Gateway Migration

**Data:** 2026-04-29
**Status:** Spec aprovado — pronto para writing-plans
**Branch:** feat/escrow-timelock

---

## 1. Objetivo

Implementar o `EscrowFacet` com Time-Lock Oracle e consolidar o Diamond como único gateway de todas as operações mutantes de tenant. Este sub-sistema cobre:

1. `EscrowFacet` — lock, release (AUTO e MANUAL), cancel e status de escrows
2. `EscrowReleaseWorker` — cron job que processa releases automáticos expirados
3. **Migração de rotas** — `lifecycle:transition` e `transfer:initiate` migrados do REST dedicado para o Diamond
4. Schema Prisma — adição de `releaseMode` e `releaseConfirmedAt` no modelo `Escrow`

---

## 2. Lei Arquitetônica — Diamond como único gateway

> A partir deste sub-sistema, o Diamond (`POST /api/v1/diamond`) é o **único** gateway para todas as operações mutantes autenticadas por tenant. Rotas REST semânticas dedicadas são removidas para operações de domínio (lifecycle, transfer, escrow). Exceções permanentes conforme CLAUDE.md Option C:
> - `POST /api/v1/webhooks/mercadopago` — webhook externo sem apiKeyAuth
> - `POST /api/v1/agent/event` — evento M2M com requireAgentSignature próprio
> - `GET /api-docs` — documentação pública

---

## 3. Schema Prisma

### 3.1 Campos adicionados ao modelo `Escrow`

```prisma
model Escrow {
  // ... campos existentes preservados ...

  releaseMode        String    @default("AUTO")  // 'AUTO' | 'MANUAL'
  releaseConfirmedAt DateTime?                   // set on manual OPERATOR release (audit)
}
```

`releaseMode` determina se o `EscrowReleaseWorker` pode processar o escrow automaticamente ou se exige chamada REST explícita de OPERATOR/ADMIN.

`releaseConfirmedAt` registra o timestamp da autorização humana no modo MANUAL (trilha de auditoria).

### 3.2 Migration

```
npm run db:migrate → add_release_mode_to_escrow
```

### 3.3 Campos já existentes (não alterar)

O modelo `Escrow` já contém: `id`, `tenantId`, `escrowId` (unique), `assetId`, `chain`, `chainTxId`, `sender`, `receiver`, `amount`, `assetAddress`, `unlockTimestamp`, `createdAt`, `updatedAt`, `status` (EscrowStatus enum), `metadata`.

`EscrowStatus` já definido: `PENDING | ACTIVE | RELEASED | CANCELLED | EXPIRED`. Adicionar valor `PROCESSING` ao enum para uso como lock atômico pelo `EscrowReleaseWorker` (mesmo padrão sentinel do `AnchorQueueService`).

`AssetStatus.LOCKED_IN_ESCROW` já existe no schema.

---

## 4. EscrowFacet

**Arquivo:** `src/services/core-facets/EscrowFacet.ts`

Segue o padrão `(secureContext, payload)` de todas as facetas. Puro: sem dependências Express.

### 4.1 `EscrowFacet.lock(secureContext, payload)`

**Pré-condições:**
- `Asset` existe e pertence ao `tenantId`
- `Asset.status === 'ACTIVE'`
- `role === 'ADMIN' | 'OPERATOR'`
- `unlockTimestamp` é Unix timestamp futuro (> `Date.now() / 1000`)

**Fluxo:**
1. Busca asset, valida estado e role
2. Cria `Escrow` com `status: 'ACTIVE'`, `releaseMode`, `unlockTimestamp`, `chain`, `sender`, `receiver`, `amount`, `assetAddress`
3. Chama `DLTAdapterFactory.getAdapter(chain).createEscrow(params)` com `pqcProof` e `tripleSign` opcionais
4. Atualiza `chainTxId` no `Escrow` criado
5. Muda `Asset.status → LOCKED_IN_ESCROW`
6. Cria `EventLog` com `action: 'ESCROW_LOCKED'`, `payload: { escrowId, chain, unlockTimestamp, releaseMode }`
7. Retorna `{ escrowId, assetId, status: 'ACTIVE', chainTxId }`

**Payload de entrada:**
```typescript
interface LockPayload {
  assetId: string
  escrowId: string           // UUID gerado pelo caller (idempotência)
  chain: SupportedChain
  sender: string             // wallet address (Omnibus ou própria)
  receiver: string           // wallet address destino
  amount: string             // menor denominação (lamports, microAlgos, etc.)
  unlockTimestamp: number    // Unix seconds, calculado server-side ou fornecido
  releaseMode: 'AUTO' | 'MANUAL'
  assetAddress?: string      // token contract (null = native)
  pqcProof?: string          // Falcon-512 Base64 (opcional)
  tripleSign?: TripleSignPayload  // Multi-sig (opcional)
}
```

### 4.2 `EscrowFacet.release(secureContext, payload)`

Usado em dois contextos:
- **MANUAL**: chamado por OPERATOR/ADMIN via Diamond selector `escrow:release`
- **AUTO**: chamado internamente pelo `EscrowReleaseWorker` com `secureContext` sintético

**Pré-condições:**
- `Escrow` existe e pertence ao `tenantId`
- `Escrow.status === 'ACTIVE'`
- Se `releaseMode === 'MANUAL'`: `role === 'ADMIN' | 'OPERATOR'`
- Se `releaseMode === 'AUTO'` e chamado via REST: rejeitar com `RELEASE_MODE_MISMATCH`

**Fluxo:**
1. Busca Escrow, valida status e modo
2. Se MANUAL: seta `releaseConfirmedAt = now()`
3. Chama `DLTAdapterFactory.getAdapter(chain).releaseEscrow(escrowId, txRef)`
4. Muda `Escrow.status → RELEASED`
5. Muda `Asset.status → ACTIVE`
6. Cria `EventLog` com `action: 'ESCROW_RELEASED'`, `payload: { escrowId, releaseMode, releasedBy }`
7. Retorna `{ escrowId, assetId, status: 'RELEASED', chainTxId }`

### 4.3 `EscrowFacet.cancel(secureContext, payload)`

**Pré-condições:**
- `role === 'ADMIN'` (cancelamento é operação destrutiva — apenas admin)
- `Escrow.status` não é `RELEASED` nem `CANCELLED`

**Fluxo:**
1. Busca Escrow, valida status e role
2. Chama `DLTAdapterFactory.getAdapter(chain).cancelEscrow(escrowId, txRef)`
3. Muda `Escrow.status → CANCELLED`
4. Muda `Asset.status → ACTIVE` (volta ao estado anterior — sem mudança de dono)
5. Cria `EventLog` com `action: 'ESCROW_CANCELLED'`, `payload: { escrowId, cancelledBy }`
6. Retorna `{ escrowId, assetId, status: 'CANCELLED', chainTxId }`

### 4.4 `EscrowFacet.getStatus(secureContext, payload)`

**Pré-condições:**
- `role === 'ADMIN' | 'OPERATOR' | 'READER'`
- `Escrow` pertence ao `tenantId`

**Fluxo:**
1. Busca Escrow com relação ao Asset
2. Retorna `{ escrowId, assetId, status, chain, releaseMode, unlockTimestamp, chainTxId, createdAt, releaseConfirmedAt }`

---

## 5. EscrowReleaseWorker

**Arquivo:** `src/services/EscrowReleaseWorker.ts`

Segue o padrão do `AnchorQueueService`: overlap-lock, batch de 10, FIFO por `unlockTimestamp`.

### 5.1 `EscrowReleaseWorker.processReleases()`

```
1. Busca Escrows:
   WHERE status = 'ACTIVE'
     AND releaseMode = 'AUTO'
     AND unlockTimestamp <= now()
   ORDER BY unlockTimestamp ASC
   TAKE 10

2. Marca atomicamente cada escrow: status = 'PROCESSING'
   (valor adicionado ao enum EscrowStatus — guard contra duplo release em ciclos sobrepostos)

3. Para cada escrow:
   a. Monta secureContext sintético: { tenantId, apiKeyId: 'ESCROW_WORKER', role: 'ADMIN' }
   b. Chama EscrowFacet.release(secureContext, { escrowId, assetId })
   c. On success: nada — EscrowFacet já atualiza status para RELEASED
   d. On error: reverte Escrow.status = 'ACTIVE', loga erro, continua próximo

4. Retorna { released: number, failed: number }
```

**Isolamento de falhas:** erro em um escrow não bloqueia o restante do batch. Escrow que falhou volta para `ACTIVE` e será reprocessado no próximo ciclo.

### 5.2 Registro no SchedulerService

```typescript
// src/services/SchedulerService.ts — adição
const escrowInterval = parseInt(process.env.ESCROW_RELEASE_INTERVAL_SECONDS ?? '60', 10);
const escrowPattern = `*/${escrowInterval} * * * * *`;

let escrowRunning = false;
cron.schedule(escrowPattern, async () => {
  if (escrowRunning) return;
  escrowRunning = true;
  try {
    const result = await EscrowReleaseWorker.processReleases();
    if (result.released > 0 || result.failed > 0) {
      console.log(`[Scheduler] EscrowRelease: ${result.released} released, ${result.failed} failed.`);
    }
  } catch (err) {
    console.error('[Scheduler] EscrowRelease error:', err);
  } finally {
    escrowRunning = false;
  }
});
console.log(`[Scheduler] EscrowRelease cron started — interval: ${escrowInterval}s`);
```

**Nova env var:** `ESCROW_RELEASE_INTERVAL_SECONDS` (default: 60)

---

## 6. FacetRegistry — Seletores

### 6.1 Seletores novos (Escrow)

```typescript
// src/diamond/FacetRegistry.ts
'escrow:lock'    → (ctx, payload) => EscrowFacet.lock(ctx, payload)
'escrow:release' → (ctx, payload) => EscrowFacet.release(ctx, payload)
'escrow:cancel'  → (ctx, payload) => EscrowFacet.cancel(ctx, payload)
'escrow:status'  → (ctx, payload) => EscrowFacet.getStatus(ctx, payload)
```

### 6.2 Migração de seletores existentes

Os seletores `lifecycle:transition` e `transfer:initiate` já estão registrados no FacetRegistry (adicionados em sub-sistemas anteriores). Nenhuma alteração necessária nos seletores — apenas na camada de rota.

### 6.3 Rotas REST removidas

| Arquivo removido | Motivo |
|---|---|
| `src/routes/v1/lifecycleRoutes.ts` | Operação migrada para `lifecycle:transition` via Diamond |
| `src/controllers/LifecycleController.ts` | Lógica já está no `LifecycleFacet` |
| `src/routes/v1/transferRoutes.ts` (se existir) | Operação migrada para `transfer:initiate` via Diamond |
| `src/controllers/TransferController.ts` (se existir) | Lógica já está no `TransferRegistryFacet` |

Mount points removidos de `src/routes/index.ts`.

---

## 7. Error Handling

| Condição | Código | HTTP |
|---|---|---|
| Asset não encontrado / fora do tenant | `ASSET_NOT_FOUND` | 404 |
| Asset não está `ACTIVE` ao fazer lock | `INVALID_ASSET_STATE` | 422 |
| `unlockTimestamp` no passado | `INVALID_UNLOCK_TIMESTAMP` | 422 |
| Escrow não encontrado | `ESCROW_NOT_FOUND` | 404 |
| Escrow já `RELEASED` ou `CANCELLED` | `ESCROW_ALREADY_CLOSED` | 409 |
| Release manual tentado em escrow `AUTO` | `RELEASE_MODE_MISMATCH` | 422 |
| Role insuficiente | `INSUFFICIENT_ROLE` | 403 |
| Falha no adapter DLT | `DLT_ANCHOR_FAILED` | 502 |

---

## 8. Testing

| Arquivo | Tipo | Cobertura |
|---|---|---|
| `tests/escrow-facet.test.ts` | Unit (Prisma mock) | lock, release AUTO/MANUAL, cancel, getStatus, todas as validações de estado |
| `tests/escrow-release-worker.test.ts` | Unit (mock) | processReleases batch, overlap lock, isolamento de falha por escrow, escrows MANUAL ignorados |
| `tests/escrow-diamond.test.ts` | Integração via DiamondProxy | 4 seletores, auth, idempotência em lock/release/cancel |
| `tests/lifecycle-diamond.test.ts` | Integração | `lifecycle:transition` via Diamond (cobertura pós-migração) |
| `tests/transfer-diamond.test.ts` | Integração | `transfer:initiate` via Diamond (cobertura pós-migração) |

---

## 9. Arquivos a criar/modificar/remover

| Arquivo | Ação |
|---|---|
| `prisma/schema.prisma` | Adicionar `releaseMode` e `releaseConfirmedAt` ao model `Escrow` |
| `prisma/migrations/...add_release_mode_to_escrow/` | Criar via `npm run db:migrate` |
| `src/services/core-facets/EscrowFacet.ts` | **Criar** |
| `src/services/EscrowReleaseWorker.ts` | **Criar** |
| `src/services/SchedulerService.ts` | **Modificar** — adicionar cron do EscrowReleaseWorker |
| `src/diamond/FacetRegistry.ts` | **Modificar** — adicionar 4 seletores escrow |
| `src/routes/index.ts` | **Modificar** — remover mounts de lifecycle e transfer routes |
| `src/routes/v1/lifecycleRoutes.ts` | **Remover** |
| `src/controllers/LifecycleController.ts` | **Remover** |
| `src/routes/v1/transferRoutes.ts` | **Remover** (se existir) |
| `src/controllers/TransferController.ts` | **Remover** (se existir) |
| `.env.example` | **Modificar** — adicionar `ESCROW_RELEASE_INTERVAL_SECONDS` |
| `tests/escrow-facet.test.ts` | **Criar** |
| `tests/escrow-release-worker.test.ts` | **Criar** |
| `tests/escrow-diamond.test.ts` | **Criar** |
| `tests/lifecycle-diamond.test.ts` | **Criar** |
| `tests/transfer-diamond.test.ts` | **Criar** |

---

## 10. Variáveis de ambiente

| Variável | Default | Obrigatório |
|---|---|---|
| `ESCROW_RELEASE_INTERVAL_SECONDS` | `60` | Não |

Variáveis de adapter DLT (SOLANA_*, STELLAR_*, etc.) já documentadas no Sub-sistema 2.

---

## 11. O que NÃO está neste sub-sistema

- Smart Contracts Solana/Soroban — responsabilidade da equipe blockchain (adapters já esperam Program ID / Contract ID configurados)
- `PolygonAdapter` / `EthereumAdapter` — fase 2 do Sub-sistema 2
- UI/Frontend para operações de escrow — responsabilidade do frontend
- Disputa on-chain (multi-sig arbitration) — fase futura se necessário
- Migração das rotas de agente (`/api/v1/agents`, `/api/v1/agent/event`) — já seguem o padrão correto

---

## 12. Dependências

| Dependência | Status |
|---|---|
| `LifecycleFacet` com `LOCKED_IN_ESCROW` guard | ✅ Sub-sistema 1 |
| `DLTAdapterFactory` multi-chain | ✅ Sub-sistema 2 |
| `IDLTAdapter.createEscrow / releaseEscrow / cancelEscrow` | ✅ Sub-sistema 2 |
| `SolanaAdapter` com PDA escrow | ✅ Sub-sistema 2 |
| `SorobanAdapter` (Stellar) | ✅ Sub-sistema 2 |
| Modelo `Escrow` + `EscrowStatus` no schema | ✅ Já existe |
| `LOCKED_IN_ESCROW` no enum `AssetStatus` | ✅ Já existe |
| `SchedulerService` com padrão overlap-lock | ✅ Sub-sistema 1 |
| `DiamondProxy` + `FacetRegistry` | ✅ Core |
