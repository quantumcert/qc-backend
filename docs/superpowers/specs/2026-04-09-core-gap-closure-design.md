# Spec: Sub-sistema 1 — Core Gap Closure

**Data:** 2026-04-09  
**Status:** Aprovado  
**Repositório:** `backend-QC-new`  
**Próximo passo:** Sub-sistema 3 (Document Verification)

---

## Contexto

O codebase Quantum Cert v3.0.0 possui 4 gaps que impedem o funcionamento da espinha dorsal do sistema:

1. `LifecycleFacet` — arquivo existe, conteúdo é `export {}` (zero implementação)
2. `TransferRegistryFacet` — lógica interna correta, mas sem rota REST exposta e sem registro no `FacetRegistry`
3. MercadoPago webhook — `paymentRoutes.ts` e `routes/index.ts` deprecated e vazios
4. `AnchorQueueService` — implementação sólida (FIFO, lock atômico, batch, DLQ), sem nenhum gatilho/scheduler

---

## Lei de Arquitetura (Option C — Roteamento Híbrido)

> Operações autenticadas do tenant → `POST /api/v1/diamond` (seletores no FacetRegistry).  
> Integrações externas e mudanças de estado semânticas → rotas REST dedicadas com middleware próprio.

Webhooks externos têm contrato imutável de URL com o provedor. Mudança de estado de lifecycle é naturalmente RESTful (`PATCH`). Tudo que é operação interna do tenant pode e deve passar pelo Diamond Proxy.

---

## Seção 1: Mapa de Rotas e Arquivos

### Novos arquivos

```
src/
├── routes/v1/
│   ├── transferRoutes.ts        # PATCH /api/v1/assets/:assetId/transfer
│   ├── lifecycleRoutes.ts       # PATCH /api/v1/assets/:assetId/lifecycle
│   └── webhookRoutes.ts         # POST  /api/v1/webhooks/mercadopago
├── controllers/
│   ├── TransferController.ts
│   ├── LifecycleController.ts
│   └── WebhookController.ts
└── services/
    ├── SchedulerService.ts
    └── core-facets/
        └── LifecycleFacet.ts    # substituir export {} atual
```

### Montagem em `routes/index.ts`

```
PATCH  /api/v1/assets/:assetId/transfer   → TransferController → TransferRegistryFacet
PATCH  /api/v1/assets/:assetId/lifecycle  → LifecycleController → LifecycleFacet
POST   /api/v1/webhooks/mercadopago       → WebhookController → BillingFacet
POST   /api/v1/diamond                    → DiamondProxy (existente, sem alteração)
```

### Novos seletores no `FacetRegistry`

```typescript
'transfer.initiate':    TransferRegistryFacet.initiateTransfer,
'lifecycle.transition': LifecycleFacet.transition,
```

O webhook MercadoPago **não** entra no FacetRegistry — é externo, sem `apiKeyAuth`, com validação própria.

---

## Seção 2: LifecycleFacet — Máquina de Estados

### Estados e transições permitidas

```
DRAFT → ACTIVE → SUSPENDED → ARCHIVED
         ↑            |
         └────────────┘  (reativação: SUSPENDED → ACTIVE permitida)

ACTIVE → BURNED            (terminal, irreversível)
ACTIVE → AWAITING_PAYMENT  (controlado por TransferRegistryFacet, não por esta rota)
ACTIVE → LOCKED_IN_ESCROW  (controlado por EscrowFacet — Sub-sistema 5)

AWAITING_PAYMENT  → ACTIVE          (controlado por BillingFacet/webhook, não por esta rota)
LOCKED_IN_ESCROW  → ACTIVE          (somente após liberação pelo EscrowFacet)

⚠️  LOCKED_IN_ESCROW é estado de proteção:
    - Bloqueia transições para SUSPENDED, ARCHIVED ou qualquer transferência
    - Só pode ser liberado pelo EscrowFacet (sub-sistema 5)
    - O LifecycleFacet rejeita qualquer tentativa de transição direta saindo desse estado
      com ASSET_LOCKED_IN_ESCROW (HTTP 423 Locked)
```

### Matriz de guarda de transições

| De | Para | Roles permitidos |
|---|---|---|
| `DRAFT` | `ACTIVE` | `ADMIN`, `OPERATOR` |
| `ACTIVE` | `SUSPENDED` | `ADMIN` |
| `SUSPENDED` | `ACTIVE` | `ADMIN` |
| `ACTIVE` | `ARCHIVED` | `ADMIN` |
| `ACTIVE` | `BURNED` | `ADMIN` |
| `ACTIVE` | `LOCKED_IN_ESCROW` | Interno — EscrowFacet apenas |
| `LOCKED_IN_ESCROW` | `ACTIVE` | Interno — EscrowFacet apenas |

Qualquer transição não listada retorna erro `STATE_TRANSITION_FORBIDDEN` com HTTP 422.  
Tentativa de transição em ativo `LOCKED_IN_ESCROW` retorna `ASSET_LOCKED_IN_ESCROW` com HTTP 423.

### Interface do Facet

```typescript
// LifecycleFacet.transition(secureContext, payload)
payload: {
  assetId: string
  targetState: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'BURNED'
  reason?: string
  // LGPD / Lei de Arquitetura:
  // O campo `reason`, junto com todo o payload do evento, sofre hash SHA3-512
  // antes de ser enfileirado no AnchorQueueService.
  // APENAS O HASH vai para o campo `note` da DLT — NUNCA texto livre.
  // O texto original permanece exclusivamente no EventLog (banco PostgreSQL),
  // coberto pela LGPD e sob controle do Tenant.
}
```

### Efeito colateral obrigatório

Toda transição bem-sucedida cria um `EventLog`:
```json
{
  "action": "LIFECYCLE_TRANSITION",
  "fromState": "<estado anterior>",
  "toState": "<novo estado>",
  "reason": "<reason ou null — armazenado em texto no banco, nunca exposto na DLT>",
  "origin": "<apiKeyId do caller>"
}
```

O payload completo desse `EventLog` é serializado e hashed com SHA3-512 pelo `AnchorQueueService`  
antes de qualquer ancoragem. A DLT recebe apenas `SHA3-512(payload)` — zero dados pessoais ou texto livre.

Isso garante auditoria completa do ciclo de vida de qualquer ativo, independente do seu domínio.

---

## Seção 3: TransferRegistryFacet REST + MercadoPago Webhook

### Regra de Negócio — KYC por Documento Legal (CPF/CNPJ)

> **CRÍTICO:** O identificador universal de comprador na plataforma Quantum Cert é o documento legal  
> (CPF ou CNPJ), nunca e-mail. E-mail permite a criação de contas fantasma e destrói a cadeia de  
> custódia jurídica. O CPF é também a chave Pix utilizada no comissionamento de afiliados, tornando-o  
> o identificador unificado em toda a esteira financeira.

### Rota de Transferência

```
PATCH /api/v1/assets/:assetId/transfer
Middleware: requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator
```

**Request body:**
```json
{
  "buyerDocument": "12345678909",
  "documentType": "CPF"
}
```

`documentType` aceita `"CPF"` ou `"CNPJ"`. O campo `buyerDocument` pode receber o número formatado  
(`"123.456.789-09"`) ou apenas dígitos (`"12345678909"`) — a normalização (remoção de máscara) ocorre  
no `TransferController` antes de delegar ao Facet.

**Lógica de Shadow Account por Documento:**

O `TransferRegistryFacet.initiateTransfer` executa:
1. Normaliza `buyerDocument` (remove pontuação)
2. Busca `Owner` existente no Tenant pelo documento: `WHERE tenantId = ? AND document = ?`
3. Se não existir → cria Shadow Account: `{ tenantId, document, documentType, status: 'SHADOW' }`
4. Vincula o `ownerId` resultante à transferência pendente
5. Transita o ativo para `AWAITING_PAYMENT`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "assetId": "...",
    "status": "AWAITING_PAYMENT",
    "paymentLink": "https://www.mercadopago.com.br/checkout/...",
    "buyerDocument": "12345678909",
    "documentType": "CPF",
    "buyerOwnerId": "<id interno do Owner criado ou localizado>"
  }
}
```

O `TransferController` extrai `assetId` da URL e `{ buyerDocument, documentType }` do body,  
constrói `secureContext` via middleware (padrão existente), delega para  
`TransferRegistryFacet.initiateTransfer`.

### Webhook MercadoPago

```
POST /api/v1/webhooks/mercadopago
Auth: NENHUMA (chamada externa pelo servidor do MP)
```

**Fluxo de validação HMAC obrigatório (antes de qualquer processamento):**

1. Extrair `x-signature` e `x-request-id` do header da requisição
2. Extrair `data.id` e `ts` do query string do MP
3. Construir template: `id:{paymentId};request-id:{x-request-id};ts:{ts};`
4. Calcular HMAC-SHA256 com `MP_WEBHOOK_SECRET` (`.env`)
5. Comparar com valor em `x-signature` usando comparação de tempo constante (`crypto.timingSafeEqual`)
6. Se inválido → `401` imediato, sem processar, sem log de payload

**Inbox Pattern — Persistência obrigatória antes do 200 OK:**

> **CRÍTICO:** Não processar na memória e responder 200 OK. Se o processo crashar após o 200  
> e antes do processamento, o pagamento é perdido sem possibilidade de retry.

O `WebhookController` executa **em sequência obrigatória**:

```
1. Validar assinatura HMAC (rejeita com 401 se inválida)
2. Persistir payload bruto no banco → tabela `WebhookInbox`
   { provider: 'MERCADOPAGO', rawPayload: <JSON bruto>, status: 'PENDING', receivedAt: now() }
3. Responder 200 OK ← somente após confirmação de escrita no banco
4. O BillingFacet lê da tabela WebhookInbox (status: PENDING) para processar
   Atualiza status para PROCESSING → DONE (ou FAILED com contador de retentativas)
```

Isso garante que qualquer crash ou restart do processo encontre o evento salvo e possa reprocessá-lo.  
O `SchedulerService` ou um job separado varrer `WebhookInbox WHERE status IN ('PENDING','FAILED')`  
para retentativas automáticas com backoff.

**Novo modelo Prisma necessário:** `WebhookInbox`  
**Nova variável de ambiente:** `MP_WEBHOOK_SECRET`

---

## Seção 4: IDLTAdapter — Contrato Agnóstico de Ancoragem

### Lei de Arquitetura — Plugabilidade DLT

> O Core da Quantum Cert (Diamond, AnchorQueueService, Facets) é completamente **cego** sobre  
> como cada DLT funciona. Cada blockchain tem regras exclusivas de espaço e custo de ancoragem.  
> O Core só emite: **"Aqui está um Hash SHA3-512 em bytes — ancore e me devolva o TxID"**.

### Interface `IDLTAdapter`

```typescript
// src/interfaces/IDLTAdapter.ts

export interface IDLTAdapter {
  /**
   * Ancora um evento na DLT.
   * @param payloadHash - SHA3-512 do EventLog serializado, em Buffer (bytes, não hex string)
   *                      Economiza espaço em redes com limite de nota/calldata.
   * @param eventId     - ID interno do EventLog (para correlação em logs, não vai para a DLT)
   * @param options     - Parâmetros opcionais específicos do adapter (ex: fee, priority)
   * @returns           - Transaction ID da DLT (string opaca para o Core)
   */
  anchorEvent(
    payloadHash: Buffer,
    eventId: string,
    options?: Record<string, unknown>
  ): Promise<string>

  /**
   * Verifica se um TxID contém o hash esperado (Oráculo de validação independente).
   * @param dltTxId      - Transaction ID retornado por anchorEvent
   * @param expectedHash - SHA3-512 esperado, em Buffer
   * @returns            - true se a DLT confirma o hash; false se não encontrado ou divergente
   */
  verifyAnchor(dltTxId: string, expectedHash: Buffer): Promise<boolean>
}
```

### Estratégias de ancoragem por rede (referência para Sub-sistema 2)

| Adapter | Mecanismo | Limite de espaço |
|---|---|---|
| `AlgorandAdapter` | Campo `Note` em txn zero-value | 1 KB |
| `SolanaAdapter` | `Instruction Data` (econômico) ou PDA de 97 bytes (M2M) | ~1232 bytes |
| `PolygonAdapter` / `EthereumAdapter` | `Calldata` de auto-transferência ou `Event Log` em contrato base | ~3,5 KB calldata |
| `StellarAdapter` | Campo `memo` (hash truncado) ou `ManageData` operation | 28 bytes (memo) / 64 bytes (ManageData) |

O Core envia sempre `Buffer` (bytes) — cada adapter decide a codificação (hex, base64, raw) conforme  
o limite da sua rede, sem nenhuma mudança no `AnchorQueueService`.

### `DLTAdapterFactory`

```typescript
// src/services/DLTAdapterFactory.ts

import { IDLTAdapter } from '../interfaces/IDLTAdapter'
import { AlgorandAnchorFacet } from './core-facets/AlgorandAnchorFacet'
// import { SolanaAdapter } from './adapters/SolanaAdapter'    // Sub-sistema 2
// import { PolygonAdapter } from './adapters/PolygonAdapter'  // Sub-sistema 2

export type SupportedChain = 'ALGORAND' | 'SOLANA' | 'POLYGON' | 'ETHEREUM' | 'STELLAR'

export class DLTAdapterFactory {
  /**
   * Retorna o adapter correto para a chain configurada no Tenant/Ativo.
   * O AnchorQueueService e o SchedulerService NUNCA instanciam adapters diretamente.
   */
  static getAdapter(targetChain: SupportedChain): IDLTAdapter {
    switch (targetChain) {
      case 'ALGORAND':
        return new AlgorandAnchorFacet()
      // case 'SOLANA':
      //   return new SolanaAdapter()
      // case 'POLYGON':
      //   return new PolygonAdapter()
      default:
        throw new Error(`DLT adapter not implemented for chain: ${targetChain}`)
    }
  }
}
```

O `targetChain` é lido da configuração do Tenant (campo `targetChain` no modelo `Tenant`) ou do  
`Asset` em casos de configuração por ativo. O `AnchorQueueService` chama  
`DLTAdapterFactory.getAdapter(event.tenant.targetChain)` por lote, sem nenhuma lógica de chain hardcoded.

---

## Seção 5: SchedulerService — AnchorQueue Trigger

### Decisão arquitetônica

**MVP:** `node-cron` embutido no processo principal, instanciado em `SchedulerService` desacoplado.  
**Scale-out (futuro):** mover `SchedulerService.start()` para `src/worker.ts` — zero mudanças no `AnchorQueueService`.  
**Multi-réplica (futuro):** o lock atômico por row (`dltTxId: 'PROCESSING'`) já previne double-processing sem código adicional.

### Interface do SchedulerService

```typescript
// src/services/SchedulerService.ts
class SchedulerService {
  static start(): void
  // Registra todos os cron jobs. NÃO recebe adapter como parâmetro.
  // Não contém lógica de negócio — é apenas o gatilho de tempo (cron).
  // A resolução da blockchain ocorre DENTRO do AnchorQueueService,
  // por evento/tenant, no momento do processamento — nunca na inicialização.
}
```

### Configuração do cron

| Parâmetro | Valor MVP | Fonte |
|---|---|---|
| Frequência | 30 segundos | `ANCHOR_QUEUE_INTERVAL_SECONDS` (env, default: `30`) |
| Padrão cron | `"*/30 * * * * *"` | Calculado a partir da env |
| Proteção overlap | `runningLock: boolean` por job | Hardcoded no SchedulerService |
| Batch size | 10 eventos por ciclo | `AnchorQueueService` (existente, não alterado) |

### Montagem em `server.ts`

```typescript
// Após app.listen(), no final do arquivo:
SchedulerService.start()
// Sem injeção de adapter. O SchedulerService é apenas o gatilho de tempo (cron).
```

### Resolução dinâmica da blockchain — no loop do `AnchorQueueService`

```typescript
// Dentro de AnchorQueueService.processQueue():

// 1. Busca o lote incluindo o targetChain do Tenant de cada evento
const pendingEvents = await prisma.eventLog.findMany({
  where: { ... },
  include: { tenant: { select: { targetChain: true } } },
  take: 10
})

// 2. Agrupa eventos por chain para minimizar instanciações de adapter
const byChain = Map.groupBy(pendingEvents, e => e.tenant.targetChain ?? 'ALGORAND')

// 3. Para cada grupo, instancia o adapter correto e ancora
for (const [chain, events] of byChain) {
  const adapter = DLTAdapterFactory.getAdapter(chain)
  for (const event of events) {
    const txId = await adapter.anchorEvent(event.id, event.signatureHash!)
    // ... update EventLog com txId
  }
}
```

A resolução da blockchain ocorre **por evento/tenant no momento do processamento** —  
nunca na inicialização do servidor. Um batch de 10 eventos com 5 tenants Algorand e 5  
tenants Solana ancoram corretamente em redes distintas no mesmo ciclo de cron.

**Nova dependência:** `node-cron` + `@types/node-cron`  
**Nova variável de ambiente:** `ANCHOR_QUEUE_INTERVAL_SECONDS` (default: `30`)

---

## Variáveis de Ambiente Novas

| Variável | Descrição | Default |
|---|---|---|
| `MP_WEBHOOK_SECRET` | Chave HMAC para validação de webhooks MercadoPago | obrigatório |
| `ANCHOR_QUEUE_INTERVAL_SECONDS` | Intervalo do cron da fila de ancoragem (segundos) | `30` |

---

## Dependências Novas

| Pacote | Uso |
|---|---|
| `node-cron` | Cron job do SchedulerService |
| `@types/node-cron` | Tipos TypeScript (devDependency) |

---

## Schema Prisma — Novos modelos necessários

### `WebhookInbox` (Inbox Pattern — resiliência de pagamentos)

```prisma
model WebhookInbox {
  id           String   @id @default(cuid())
  provider     String   // 'MERCADOPAGO'
  rawPayload   Json     // payload bruto recebido, sem modificação
  status       String   @default("PENDING") // PENDING | PROCESSING | DONE | FAILED
  retryCount   Int      @default(0)
  lastError    String?
  receivedAt   DateTime @default(now())
  processedAt  DateTime?

  @@index([status, receivedAt])
}
```

> Nota: O campo `document` já deve existir (ou ser adicionado) no modelo `Owner` para suportar  
> a busca por CPF/CNPJ. Verificar schema atual antes de `db:migrate`.

---

## O que NÃO está no escopo deste sub-sistema

- Implementação de adapters DLT adicionais (Solana, Stellar, Polygon, Ethereum) → Sub-sistema 2
- DocumentVerificationFacet e endpoint público de verificação → Sub-sistema 3
- AgentRegistryFacet e rotas M2M → Sub-sistema 4
- EscrowFacet e Time-Lock Oracle → Sub-sistema 5
- Alterações no schema Prisma (todos os campos necessários já existem)
- Alterações na lógica interna do `TransferRegistryFacet` ou `BillingFacet`
