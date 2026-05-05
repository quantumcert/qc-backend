# Solana Anchor Hackathon — Design Spec

**Data:** 2026-05-03
**Status:** Aprovado
**Contexto:** Apresentação do Quantum Cert no hackathon da Solana. Demo end-to-end de certificação de ativos com ancoragem real na devnet Solana via programa Anchor. Hackathon Solana ocorre **antes** do hackathon Stellar — esta spec tem prioridade de implementação. Referência oficial: https://solana.com/docs

---

## 1. Objetivo

Apresentar o Quantum Cert como uma plataforma **chain-agnostic de certificação de ativos**, com Solana/Anchor como chain primária na demo. O mesmo fluxo end-to-end da demo Stellar é replicado para Solana — mesma narrativa, mesmo frontend, chain diferente. O `SolanaAdapter` existente é completado e validado contra um programa Anchor real deployado na devnet.

---

## 2. Particularidades do Solana vs Stellar

| Aspecto | Stellar/Soroban | Solana/Anchor |
|---|---|---|
| Linguagem do contrato | Rust (Soroban SDK) | Rust (Anchor framework) |
| Storage | `storage().persistent()` | PDA accounts (rent-exempt) |
| Leitura on-chain | `get_anchor(event_id)` via RPC | `getAccountInfo(anchorPda)` via RPC |
| Discriminators | Automático pelo SDK | 8 bytes sha256 do nome da instruction |
| Escrow | Contrato futuro (não na demo) | PDA escrow no mesmo programa |
| Explorer | Stellar Expert | Solana Explorer / SolScan |
| Faucet | Friendbot (HTTP) | `connection.requestAirdrop` (RPC devnet) |
| Confirmação | ~5-10s | ~400ms |

---

## 3. Programa Anchor (Rust)

### Localização
```
contracts/quantum-anchor-solana/
├── Cargo.toml
├── Anchor.toml
└── programs/
    └── quantum-anchor/
        └── src/
            └── lib.rs
```

### Instructions

```rust
fn anchor_pda(ctx: Context<AnchorPda>, event_id: String, hash: Vec<u8>)
fn create_escrow(ctx: Context<CreateEscrow>, escrow_id: String, receiver: Pubkey, amount: u64, unlock_timestamp: i64)
fn release_escrow(ctx: Context<ReleaseEscrow>, escrow_id: String)
fn cancel_escrow(ctx: Context<CancelEscrow>, escrow_id: String)
```

### PDAs e Account Layout

| Account | Seeds | Campos |
|---|---|---|
| `AnchorRecord` | `["qc_anchor", event_id]` | `authority: Pubkey`, `hash: Vec<u8>`, `timestamp: i64` |
| `EscrowRecord` | `["qc_escrow", escrow_id]` | `sender: Pubkey`, `receiver: Pubkey`, `amount: u64`, `unlock_timestamp: i64`, `released: bool` |

Seeds idênticas às já usadas no `SolanaAdapter`:
- `[Buffer.from('qc_anchor'), Buffer.from(eventId)]`
- `[Buffer.from('qc_escrow'), Buffer.from(escrowId)]`

### Controle de acesso

| Instruction | Quem pode chamar |
|---|---|
| `anchor_pda` | Apenas `authority` (keypair deployado) |
| `create_escrow` | Qualquer conta (sender é o signer) |
| `release_escrow` | Qualquer conta — programa valida `unlock_timestamp` |
| `cancel_escrow` | Apenas `authority` |

### Modo de anchoring padrão
**Mode B (PDA)** é o padrão. Mode A (LOG/instruction data) existe como fallback via `options.mode = 'LOG'` no `SolanaAdapter`, mas não é demonstrado.

### Deploy
```bash
anchor build
anchor deploy --provider.cluster devnet
# PROGRAM_ID retornado → SOLANA_ANCHOR_PROGRAM_ID no .env
```

---

## 4. Mudanças no Backend (`qc-backend`)

### 4.1 Script de provisioning
**Novo arquivo:** `src/scripts/provision-solana.ts`

Responsabilidades:
1. Gera keypair Solana (ou lê `SOLANA_AUTHORITY_PRIVATE_KEY` se já existir)
2. Solicita airdrop via devnet: `connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL)`
3. Aguarda confirmação do airdrop
4. Imprime env vars prontas para copiar no `.env`

Execução única: `npx tsx src/scripts/provision-solana.ts`

### 4.2 `SolanaAdapter` — atualizações

**`anchorEvent` — Mode B como padrão:**
```typescript
// Antes
const mode: AnchorMode = options?.mode ?? 'LOG';
// Depois
const mode: AnchorMode = options?.mode ?? 'PDA';
```

**`verifyAnchor` — leitura via PDA (modo profundo):**

Quando `expectedHash` é fornecido:
1. Buscar `event_id` via `prisma.eventLog.findFirst({ where: { dltTxId: txId } })`
2. Derivar PDA: `PublicKey.findProgramAddressSync([Buffer.from('qc_anchor'), Buffer.from(eventId)], programId)`
3. Chamar `connection.getAccountInfo(anchorPda)`
4. Deserializar account data: offset 8 (discriminator Anchor) + 32 (Pubkey authority) + 4 (length prefix Vec<u8>) = byte 44 onde o hash começa. Comparar com `expectedHash`.

Quando `expectedHash` não fornecido: permanece igual — `getTransaction(txId)` verifica ausência de erro.

**Discriminators — atualizar após `anchor build`:**

Extrair do IDL gerado em `target/idl/quantum_anchor.json` e substituir as constantes hardcodadas:
```typescript
const DISCRIMINATOR_ANCHOR_PDA = Buffer.from([...]); // sha256("global:anchor_pda")[0..8]
const DISCRIMINATOR_CREATE_ESCROW = Buffer.from([...]); // sha256("global:create_escrow")[0..8]
const DISCRIMINATOR_RELEASE_ESCROW = Buffer.from([...]); // sha256("global:release_escrow")[0..8]
const DISCRIMINATOR_CANCEL_ESCROW = Buffer.from([...]); // sha256("global:cancel_escrow")[0..8]
```

### 4.3 Endpoint `/verify/document/:hash` — explorerUrl dinâmico

```typescript
const explorerUrl = chain === 'STELLAR'
  ? `https://stellar.expert/explorer/testnet/tx/${txId}`
  : chain === 'SOLANA'
  ? `https://explorer.solana.com/tx/${txId}?cluster=devnet`
  : `https://explorer.solana.com/tx/${txId}`;
```

### 4.4 Novas env vars
```bash
# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_AUTHORITY_PRIVATE_KEY=<base64-encoded-keypair>
SOLANA_ANCHOR_PROGRAM_ID=<program-id-após-deploy>
```

`TARGET_CHAIN=SOLANA` ativa o adapter no `AnchorQueueService` e na `AnchorFacet`.

### 4.5 `.env.example`
Adicionar bloco `# Solana` com as três vars acima. O bloco `# Stellar` permanece — ambos coexistem. `TARGET_CHAIN` determina qual chain está ativa.

---

## 5. Frontend (`qc-dashboard`)

**Zero mudança adicional.** A rota `/verify` implementada para o hackathon Stellar já é chain-agnostic: exibe `chain`, `txId` e `explorerUrl` retornados pelo backend.

Diferença visível ao júri:

| Campo | Stellar | Solana |
|---|---|---|
| Badge chain | `Stellar Testnet` | `Solana Devnet` |
| Link explorer | Stellar Expert | Solana Explorer |

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
→ SolanaAdapter.anchorEvent (Mode B/PDA)
→ PDA account criada na devnet com hash persistido
→ EventLog.dltTxId = assinatura da transação Solana

Passo 4 — Verificação via API
GET /api/v1/verify/document/:hash
→ PDA lida via getAccountInfo → hash bate → verified: true

Passo 5 — Verificação visual no dashboard
/verify?hash=<hash> → badge VERIFICADO ✓ + link Solana Explorer

Passo 6 — Prova on-chain ao vivo
Júri clica → Solana Explorer mostra a transação + PDA account
com o hash gravado na devnet, sem intermediários
```

---

## 7. Dependências e Tooling

| Dependência | Uso |
|---|---|
| `@solana/web3.js` | Já instalado no backend |
| `anchor-lang` (Rust) | Programa Anchor |
| `anchor CLI` | Build e deploy do programa (dev machine) |
| Solana CLI | Keypair e airdrop devnet |
| Solana Explorer | Explorer devnet para a demo |
| SolScan | Explorer alternativo |

---

## 8. Ordem de Implementação

Esta spec tem **prioridade sobre a spec Stellar** (hackathon Solana ocorre primeiro).

Implementar nesta ordem:
1. Programa Anchor (Rust) + deploy devnet
2. Script `provision-solana.ts`
3. Atualizar `SolanaAdapter` (mode default + verifyAnchor + discriminators)
4. Atualizar `explorerUrl` no endpoint `/verify`
5. Validar fluxo completo end-to-end na devnet

---

## 9. O que NÃO está no escopo desta spec

- SPL Token anchoring (tokens da Solana)
- Migração de dados de outra chain para Solana
- Alterações no `SorobanAdapter` ou contrato Stellar (spec separada)
- Escrow demonstrado na demo (programa suporta, mas a demo foca em anchoring)
