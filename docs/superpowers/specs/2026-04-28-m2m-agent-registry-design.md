# Sub-sistema 4 — M2M / Agent Registry: Design

**Data:** 2026-04-28  
**Status:** Aprovado para implementação

---

## Objetivo

Habilitar robôs e dispositivos IoT a se autenticar e emitir eventos na plataforma Quantum Cert via HTTP/REST, com identidade de máquina rastreável, assinatura Falcon-512 por payload e permissões granulares por seletor.

---

## Contexto e dependências

- **Sub-sistema 1 (Core Gap Closure):** implementado — `EventLog`, `AnchorQueueService`, `SchedulerService` disponíveis
- **Sub-sistema 2 (DLT Workers):** implementado — eventos ancorados automaticamente via fila existente
- **`Device` model:** entidade distinta — representa hardware NFC físico (NTAG 424 DNA). `Agent` representa identidade de máquina de software/IoT. Não são intercambiáveis.
- **`PostQuantumCrypto`:** `src/utils/PostQuantumCrypto.ts` já implementa Falcon-512 — reutilizado para verificação de assinatura de Agent

---

## Arquitetura

### Fluxo de registro (ADMIN)

```
Admin → POST /api/v1/diamond { selector: "agent.register", payload }
  → requireApiKey (role: ADMIN)
  → AgentRegistryFacet.register()
  → cria Agent + ApiKey vinculada (role: OPERATOR, isAgent implícito via agentId)
  → retorna { agentId, rawApiKey } — raw key exibida única vez
```

### Fluxo de evento M2M (robô)

```
Robô → POST /api/v1/agent/event
  Header: X-API-Key: qc_...
  Header: X-Idempotency-Key: <uuid>
  Body: { selector, assetId, payload, signature }
         └─ signature = Falcon512.sign(JSON.stringify({ selector, assetId, payload }))

  → requireApiKey       — valida chave, injeta { tenantId, apiKeyId, role }
  → requireAgentSignature:
      1. busca Agent por apiKeyId
      2. verifica agent.isActive
      3. verifica Falcon-512: sign(body sem signature) === publicKeyFalcon
      4. verifica selector ∈ agent.allowedSelectors
      5. injeta agentId no secureContext
  → AgentController.handleEvent()
  → executa Facet via FacetRegistry (sem HTTP round-trip)
  → cria EventLog com agentId no metadata
  → AnchorQueueService ancora normalmente
```

---

## Schema Prisma

### Novo modelo `Agent`

```prisma
model Agent {
  id               String   @id @default(cuid())

  tenantId         String
  tenant           Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  name             String
  description      String?

  // Chave pública Falcon-512 em base64 — usada para verificar assinatura de cada payload
  publicKeyFalcon  String

  // Seletores que este Agent pode executar (ex: ["event.create"])
  allowedSelectors String[]

  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // ApiKey vinculada — gerada no registro, role OPERATOR
  apiKeyId         String?  @unique
  apiKey           ApiKey?  @relation(fields: [apiKeyId], references: [id])

  @@index([tenantId])
}
```

### Modificação em `ApiKey`

```prisma
model ApiKey {
  // ... campos existentes ...

  // Back-reference para Agent — sem coluna adicional no banco
  // A FK está em Agent.apiKeyId
  agent Agent?
}
```

---

## Novos arquivos

| Arquivo | Propósito |
|---|---|
| `src/services/core-facets/AgentRegistryFacet.ts` | Seletores `agent.register`, `agent.revoke`, `agent.status` |
| `src/middleware/requireAgentSignature.ts` | Valida Falcon-512 + allowedSelectors |
| `src/utils/PostQuantumCrypto.ts` | Adicionar `verifySignatureFalcon512(message, signatureB64, publicKeyB64)` |
| `src/routes/v1/agentRoutes.ts` | `POST /api/v1/agent/event` |
| `src/controllers/AgentController.ts` | Orquestra middleware → Facet → resposta |
| `tests/agent-registry.test.ts` | Testes unitários do AgentRegistryFacet |
| `tests/agent-event.test.ts` | Testes de integração do fluxo M2M |

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | Modelo `Agent`, campo `agentId` em `ApiKey` |
| `src/diamond/FacetRegistry.ts` | Seletores `agent.register`, `agent.revoke`, `agent.status` |
| `src/routes/index.ts` | Monta `agentRoutes` em `/api/v1` |

---

## `AgentRegistryFacet` — interface pública

```typescript
// selector: agent.register — ADMIN only
static async register(secureContext, payload: {
  name: string
  description?: string
  publicKeyFalcon: string  // base64
  allowedSelectors: string[]
}): Promise<{ agentId: string; rawApiKey: string }>

// selector: agent.revoke — ADMIN only
static async revoke(secureContext, payload: {
  agentId: string
}): Promise<{ revoked: true }>

// selector: agent.status — ADMIN only
static async status(secureContext, payload: {
  agentId: string
}): Promise<Agent>
```

**Invariantes:**
- `tenantId` sempre vem do `secureContext` — nunca do payload
- `rawApiKey` retornada uma única vez no registro; armazenada como bcrypt hash
- `revoke` desativa Agent (`isActive: false`) e invalida ApiKey (`isActive: false`) em transação atômica

---

## `requireAgentSignature` — lógica

```typescript
// O body que o robô assina (antes de adicionar o campo signature):
const signedBody = JSON.stringify({ selector, assetId, payload })
// Novo método a adicionar em PostQuantumCrypto:
// static async verifySignatureFalcon512(message: string, signatureB64: string, publicKeyB64: string): Promise<boolean>
// Internamente usa falcon.openDetached(signature, message, publicKey) da lib falcon-crypto
const isValid = await PostQuantumCrypto.verifySignatureFalcon512(signedBody, signature, agent.publicKeyFalcon)
```

**Geração de keypair pelo Agent (client-side):**
O robô gera seu próprio par de chaves via `falcon.keyPair()` antes do registro. Envia apenas a `publicKey` em base64 para `agent.register`. A `privateKey` fica exclusivamente no dispositivo e nunca sobe para o backend.

Falhas retornam imediatamente sem executar o Facet:

| Condição | Status | Código |
|---|---|---|
| `apiKeyId` não tem Agent vinculado | 403 | `NOT_AN_AGENT` |
| `agent.isActive === false` | 403 | `AGENT_REVOKED` |
| Assinatura Falcon-512 inválida | 403 | `INVALID_AGENT_SIGNATURE` |
| `selector ∉ allowedSelectors` | 403 | `SELECTOR_NOT_ALLOWED` |

---

## Tratamento de erros — visão completa

| Situação | HTTP | Código |
|---|---|---|
| ApiKey inválida | 401 | `INVALID_API_KEY` |
| Agent não encontrado para esta key | 403 | `NOT_AN_AGENT` |
| Agent inativo | 403 | `AGENT_REVOKED` |
| Assinatura inválida | 403 | `INVALID_AGENT_SIGNATURE` |
| Selector não permitido | 403 | `SELECTOR_NOT_ALLOWED` |
| Selector inexistente no FacetRegistry | 400 | `UNKNOWN_SELECTOR` |
| Asset não pertence ao tenant | 403 | `TENANT_MISMATCH` |

---

## Testes

### `agent-registry.test.ts`
- `agent.register` cria Agent com `allowedSelectors` e retorna `rawApiKey`
- `agent.register` por OPERATOR lança erro de role
- `agent.register` com `publicKeyFalcon` inválida (não-base64) lança erro
- `agent.revoke` desativa Agent e invalida ApiKey
- `agent.status` retorna 403 se agentId pertence a outro tenant
- Registro de Agent com mesmo `apiKeyId` duas vezes é impossível (unique constraint)

### `agent-event.test.ts`
- Payload com assinatura Falcon-512 válida + selector permitido → 200 + EventLog criado
- Assinatura inválida → 403 `INVALID_AGENT_SIGNATURE`
- Selector fora do `allowedSelectors` → 403 `SELECTOR_NOT_ALLOWED`
- Agent revogado → 403 `AGENT_REVOKED`
- EventLog criado contém `agentId` no campo `metadata`
- Idempotência: mesmo `X-Idempotency-Key` retorna 200 sem duplicar EventLog

---

## Fora de escopo (v1)

- Protocolo gRPC ou MQTT — apenas HTTP/REST nesta iteração
- `targetChain` por Agent — herda `targetChain` do Tenant via `AnchorQueueService`
- Fluxo Direto (Account Abstraction) — Agent com carteira própria é Sub-sistema 5+
- Renovação de chave pública — Agent é revogado e re-registrado com nova chave
