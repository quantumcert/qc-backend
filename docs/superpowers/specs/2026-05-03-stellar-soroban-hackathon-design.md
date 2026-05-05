# Stellar Soroban Hackathon — Design Spec

**Data:** 2026-05-03
**Status:** Aprovado
**Contexto:** Apresentação do Quantum Cert no hackathon da Stellar. Demo end-to-end de certificação de ativos com ancoragem real na testnet Stellar via contrato Soroban. O mesmo blueprint de abstração de chain servirá para o hackathon da Solana (spec separada).

---

## 1. Objetivo

Apresentar o Quantum Cert como uma plataforma **chain-agnostic de certificação de ativos**, com Stellar/Soroban como chain primária na demo. A arquitetura IDLTAdapter plugável é o argumento técnico central — Soroban é a prova viva. Nenhuma referência a Algorand aparece em superfícies públicas; o `AlgorandAdapter` permanece inativo no código, recuperável via `TARGET_CHAIN=ALGORAND`.

---

## 2. Princípios

1. **Chain default via env var** — `TARGET_CHAIN=STELLAR` no `.env`. Sem hardcode de chain em lógica de negócio.
2. **Contrato Soroban com leitura** — `anchor(event_id, hash)` + `get_anchor(event_id) → hash`. Verificação autônoma, sem depender do banco de dados.
3. **Sem breaking changes no IDLTAdapter** — interface permanece 100% agnóstica.
4. **Frontend com tela de verificação pública** — `qc-dashboard` ganha `/verify` que consulta o backend e exibe resultado da verificação on-chain com link para Stellar Expert (testnet explorer).

### O que NÃO muda
- Diamond Pattern, FacetRegistry, DiamondProxy
- IDLTAdapter, EscrowParams, TransferParams, AnchorOptions
- Adapters: EthAdapter, PolygonAdapter, SolanaAdapter, AlgorandAdapter

---

## 3. Contrato Soroban (Rust)

### Localização
```
contracts/quantum-anchor/
├── Cargo.toml
└── src/
    └── lib.rs
```

### Interface pública
```rust
fn anchor(env: Env, event_id: String, hash: Bytes)
fn get_anchor(env: Env, event_id: String) -> Option<Bytes>
fn get_anchorer(env: Env) -> Address
```

### Armazenamento
`storage().persistent()` com chave `DataKey::Anchor(event_id)` → `Bytes`.

Persistente (não `temporary`) porque a imutabilidade é o argumento central do produto.

### Controle de acesso
- `anchor`: apenas o `anchorer` (endereço que deployou o contrato) pode escrever.
- `get_anchor`: leitura pública — qualquer endereço, sem autenticação.

### Hash aceito
`Bytes` sem validação de tamanho no contrato. A validação de 32 ou 64 bytes permanece no `SorobanAdapter` (onde já existe).

### Deploy
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/quantum_anchor.wasm \
  --source <SECRET_KEY> \
  --network testnet
```
O `CONTRACT_ID` resultante vai para `STELLAR_ANCHOR_CONTRACT_ID` no `.env`.

---

## 4. Mudanças no Backend (`qc-backend`)

### 4.1 Script de provisioning
**Novo arquivo:** `src/scripts/provision-stellar.ts`

Responsabilidades:
1. Gera keypair Stellar (ou lê `STELLAR_AUTHORITY_SECRET_KEY` se já existir)
2. Faz fund via Friendbot (`https://friendbot.stellar.org/?addr=...`)
3. Imprime env vars prontas para copiar no `.env`

Execução única: `npx tsx src/scripts/provision-stellar.ts`

### 4.2 `SorobanAdapter` — atualização de `verifyAnchor`

`verifyAnchor(txId, expectedHash)` mantém dois modos de verificação:
1. **Rápido:** `sorobanServer.getTransaction(txId)` → verifica se status é `SUCCESS` (comportamento atual).
2. **Profundo (quando `expectedHash` é fornecido):** o backend faz lookup do `event_id` a partir do `txId` via `prisma.eventLog.findFirst({ where: { dltTxId: txId } })`, então chama `get_anchor(event_id)` no contrato e compara o hash retornado com `expectedHash`.

O endpoint `GET /verify/document/:hash` usa o modo profundo: busca o `EventLog` pelo `signatureHash`, obtém o `dltTxId` e o `id` (= `event_id`), e verifica on-chain via `get_anchor`.

O `anchorEvent` já está correto — sem mudança.

### 4.3 Remoção do Algorand das superfícies visíveis

| Arquivo | Mudança |
|---|---|
| `src/config/env.ts` | Remover `ALGORAND_*` / `ALGOD_*` do schema obrigatório. Adicionar `STELLAR_*` como required. Adicionar `TARGET_CHAIN` com default `'STELLAR'`. |
| `src/server.ts` | Trocar `REQUIRED_ENV_VARS`: remover `ALGOD_SERVER` + `ALGORAND_MASTER_MNEMONIC`, adicionar `STELLAR_AUTHORITY_SECRET_KEY`, `STELLAR_HORIZON_URL`, `STELLAR_SOROBAN_RPC_URL`, `STELLAR_ANCHOR_CONTRACT_ID`. |
| `prisma/schema.prisma` | `targetChain @default("STELLAR")` |
| `src/services/AnchorQueueService.ts` | Fallback `?? 'ALGORAND'` → `?? process.env.TARGET_CHAIN ?? 'STELLAR'` |
| `src/services/core-facets/AlgorandAnchorFacet.ts` | Renomear para `AnchorFacet.ts`. Internamente usa `DLTAdapterFactory.getAdapter(TARGET_CHAIN)` em vez de hardcodar `ALGORAND`. |
| `src/diamond/FacetRegistry.ts` | Atualizar import e referência para `AnchorFacet`. |
| `.env.example` | Remover vars Algorand. Adicionar bloco `# Stellar` com todas as vars necessárias. |

**`AlgorandAdapter.ts` não é deletado.** Para reativar: `TARGET_CHAIN=ALGORAND` + vars `ALGOD_*` no `.env`.

### 4.4 Endpoint de verificação pública

**Rota:** `GET /api/v1/verify/document/:hash`

Implementação chama `SorobanAdapter.verifyAnchor` passando o hash. Resposta:
```json
{
  "verified": true,
  "chain": "STELLAR",
  "txId": "abc123...",
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/abc123"
}
```

Endpoint público — sem `X-API-Key`, sem RBAC.

### 4.5 Novas env vars

```bash
# Chain padrão (STELLAR | ALGORAND | SOLANA | ETHEREUM | POLYGON)
TARGET_CHAIN=STELLAR

# Stellar
STELLAR_AUTHORITY_SECRET_KEY=S...
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_ANCHOR_CONTRACT_ID=C...
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

---

## 5. Mudanças no Frontend (`qc-dashboard`)

### 5.1 Nova rota pública `/verify`
Sem autenticação. URL compartilhável: `/verify?hash=<hex>`.

### 5.2 Componentes

**`VerifyPage`**
- **Estado input:** campo de texto para o hash + botão "Verificar". Pré-populado se `?hash=` estiver na query string.
- **Estado resultado:** card com badge `VERIFICADO ✓` ou `NÃO ENCONTRADO`, exibindo:
  - Hash verificado
  - Chain (`Stellar Testnet`)
  - Transaction ID (clicável → Stellar Expert)
  - Timestamp do anchor (se disponível)

**`VerifyBadge`** — componente menor reutilizável para outras telas (ex: detalhe de asset).

### 5.3 Integração
```
GET /api/v1/verify/document/:hash
```
Sem header de autenticação. O `explorerUrl` retornado é exibido como link direto para Stellar Expert testnet.

### 5.4 O que NÃO muda
Nenhuma tela existente é alterada. A rota `/verify` é 100% aditiva.

---

## 6. Fluxo da Demo End-to-End

```
Passo 1 — Criar asset
POST /api/v1/diamond { selector: "asset.register", payload: { name: "Obra de Arte #001" } }
→ Asset criado com status DRAFT

Passo 2 — Ativar asset
PATCH /api/v1/assets/:id/lifecycle { transition: "ACTIVATE" }
→ LifecycleFacet registra EventLog, signatureHash gerado

Passo 3 — Anchor automático (AnchorQueueService)
→ SorobanAdapter.anchorEvent chama anchor(event_id, hash) no contrato Soroban testnet
→ EventLog.dltTxId preenchido com TxID da Stellar

Passo 4 — Verificação via API
GET /api/v1/verify/document/:hash
→ get_anchor(event_id) consultado no contrato → hash bate → verified: true

Passo 5 — Verificação visual no dashboard
/verify?hash=<hash> → badge VERIFICADO ✓ + link Stellar Expert

Passo 6 — Prova on-chain ao vivo
Júri clica no explorerUrl → Stellar Expert mostra invocação do contrato com
event_id + hash gravados na testnet, sem intermediários
```

---

## 7. Dependências e Tooling

| Dependência | Uso |
|---|---|
| `@stellar/stellar-sdk` | Já instalado no backend |
| `soroban-sdk` (Rust) | Contrato Soroban |
| `stellar CLI` | Deploy do contrato (dev machine) |
| Friendbot | Fund da conta testnet (uma vez) |
| Stellar Expert | Explorer testnet para a demo |

---

## 8. O que NÃO está no escopo desta spec

- Escrow Soroban (EscrowFacet usa Soroban mas não é demonstrado na demo)
- NFT/token SAC na Stellar
- Migração de dados de Algorand para Stellar
- Alteração no SolanaAdapter (spec separada para hackathon Solana)
