# Sub-sistema 2 — Pluggable DLT Workers (Solana + Stellar)

**Data:** 2026-04-09  
**Status:** Spec formal — pronto para writing-plans  
**Ordem de execução:** 2 (após Sub-sistema 1 e Sub-sistema 3)

---

## 1. Objetivo

Tornar o `AnchorQueueService` completamente agnóstico de blockchain. Hoje ele cria um `AlgorandAnchorFacet` hard-coded. Após este sub-sistema:

- Cada Tenant tem um `targetChain` configurado no banco
- O `AnchorQueueService` agrupa eventos por chain e delega a um `DLTAdapterFactory`
- `SolanaAdapter` e `StellarAdapter` são implementados como adapters concretos
- Zero mudança no core Diamond, nos Facets existentes, ou no `SchedulerService`

---

## 2. Lei de Arquitetura — Adapter Pattern

> O Core (Diamond, AnchorQueueService, todos os Facets) é completamente **cego** sobre como cada DLT funciona.
> Ele entrega: `anchorEvent(payloadHash: Buffer, eventId: string, options?: AnchorOptions)`.
> Cada adapter decide codificação, custo, espaço e mecanismo de escrow por conta própria.

---

## 3. Interface `IDLTAdapter` v2

Substitui completamente a interface atual. A mudança de `string` para `Buffer` é a diferença crítica: cada rede tem limite diferente de bytes e codificação própria (hex, base64, raw). O adapter decide — o core nunca decide.

```typescript
// src/interfaces/IDLTAdapter.ts

/**
 * Modo de ancoragem — usado pelo SolanaAdapter.
 *
 * LOG   — Mode A: hash no Instruction Data (sem estado, sem rent).
 *         Permanente no histórico de validadores. ~5000 lamports.
 *
 * STATE — Mode B: hash em PDA de 97 bytes (M2M-readable + EscrowFacet futuro).
 *         Custo: ~0.0014 SOL rent-exempt.
 *
 * Ignorado por adapters que não têm essa distinção (Algorand, Stellar).
 */
export type AnchorMode = 'LOG' | 'STATE'

export interface AnchorOptions {
  /**
   * Solana: seleciona Mode A (Instruction Data) ou Mode B (PDA).
   * Default: 'LOG'.
   */
  mode?: AnchorMode

  /**
   * Unix timestamp (segundos) para Time-Lock futuro (EscrowFacet — Sub-sistema 5).
   * Quando presente, o Smart Contract recusa transferências antes desse timestamp.
   * Calculado server-side — nunca vem diretamente do cliente.
   */
  unlockTimestamp?: number

  /** Reservado para parâmetros futuros por rede (fee priority, memo, etc.) */
  metadata?: Record<string, unknown>
}

export interface IDLTAdapter {
  /**
   * Ancora um evento na DLT.
   * @param payloadHash SHA3-512 do EventLog como Buffer de 64 bytes.
   *                    NUNCA string hex — o adapter decide a codificação.
   * @param eventId     ID interno do EventLog (correlação, não vai para a DLT).
   * @param options     Parâmetros opcionais por rede/operação.
   * @returns           TxID opaco para o Core (formato varia por chain).
   */
  anchorEvent(payloadHash: Buffer, eventId: string, options?: AnchorOptions): Promise<string>

  /**
   * Verifica se um TxID existe on-chain.
   * @param dltTxId      TxID retornado por anchorEvent.
   * @param expectedHash Buffer de 64 bytes (SHA3-512) para verificar.
   * @returns            true se confirmado on-chain e hash coincide.
   */
  verifyAnchor(dltTxId: string, expectedHash: Buffer): Promise<boolean>
}
```

### Impacto no código existente

| Arquivo | Mudança |
|---|---|
| `src/interfaces/IDLTAdapter.ts` | Substituir pela interface acima |
| `src/services/core-facets/AlgorandAnchorFacet.ts` | Assinar `(payloadHash: Buffer, eventId: string, options?)` — lógica interna converte Buffer para hex quando necessário |
| `src/services/AnchorQueueService.ts` | Ver Seção 7 |

---

## 4. Schema Prisma — Campos novos

```prisma
// Adição ao model Tenant:
targetChain  String  @default("ALGORAND")
// Valores válidos: "ALGORAND" | "SOLANA" | "STELLAR" | "POLYGON" | "ETHEREUM"
// Sem enum Prisma — validado em runtime por DLTAdapterFactory
```

**Não há campos de EscrowFacet neste sub-sistema.** Os campos `defaultEscrowDuration`, `minEscrowDuration`, `maxEscrowDuration` pertencem ao Sub-sistema 5.

Migration: `npm run db:migrate` → `add_targetChain_to_tenant`

---

## 5. SolanaAdapter

### Regra de Segurança — Anti-Drift Hardening

> **DURABLE NONCES BANIDOS.**
> Após o Drift Exploit, Durable Nonces permitem que transações assinadas permaneçam válidas indefinidamente — vetor de replay em caso de vazamento de chave.
> Todo o sistema Quantum Cert usa **apenas** `recent blockhash` com `lastValidBlockHeight` enforcement.
> A transação expira automaticamente em ~90 segundos (150 blocos).
> O Program Rust on-chain deve conter um guard que **rejeita** qualquer instrução precedida de `AdvanceNonceAccount`.

### Dois modos de ancoragem

#### Mode A — `LOG` (padrão)

```
Instruction Data layout (88 bytes):
  discriminator  (8b)  = "QC_LOG_A" [0x51,0x43,0x5f,0x4c,0x4f,0x47,0x5f,0x41]
  eventId slice  (16b) = primeiros 16 bytes do eventId em UTF-8
  payloadHash    (64b) = SHA3-512 do EventLog como bytes raw

Custo: ~5000 lamports (~0.000005 SOL)
Permanência: histórico imutável de validadores (sem rent)
Uso: produção padrão para todos os ativos
```

#### Mode B — `STATE` (M2M-readable)

```
PDA derivada: seeds = ["qc_anchor", eventId[0..16]]
Tamanho: 97 bytes

Layout PDA:
  authority   (32b) = Quantum Cert master wallet pubkey
  payloadHash (64b) = SHA3-512 raw bytes
  status      ( 1b) = 0x01 ANCHORED | 0x02 ESCROW_LOCKED

Instruction Data layout (113 bytes):
  discriminator    (8b)  = "QC_PDA_B" [0x51,0x43,0x5f,0x50,0x44,0x41,0x5f,0x42]
  unlockTimestamp  (8b)  = i64 little-endian; 0 se não for escrow
  pdaData          (97b) = conteúdo completo da PDA

Custo: ~0.0014 SOL rent-exempt (permanente)
Uso: ativos que precisam de leitura M2M on-chain ou EscrowFacet (Sub-sistema 5)
```

### Variáveis de ambiente

```
SOLANA_RPC_URL                — ex: https://api.mainnet-beta.solana.com
SOLANA_AUTHORITY_PRIVATE_KEY  — Base64 de 64 bytes (Uint8Array) da keypair master
SOLANA_ANCHOR_PROGRAM_ID      — Program ID deployado (base58)
```

### Dependência npm

```
@solana/web3.js  ^1.95.x
```

### Estrutura da classe

```typescript
// src/services/adapters/SolanaAdapter.ts

export class SolanaAdapter implements IDLTAdapter {
  private connection: Connection
  private authority: Keypair
  private programId: PublicKey

  constructor() {
    // Lê SOLANA_RPC_URL, SOLANA_AUTHORITY_PRIVATE_KEY, SOLANA_ANCHOR_PROGRAM_ID
    // Lança Error se qualquer env var estiver ausente
  }

  async anchorEvent(payloadHash: Buffer, eventId: string, options?: AnchorOptions): Promise<string> {
    // Valida: payloadHash.length === 64 (Buffer de 64 bytes obrigatório)
    // Obtém: getLatestBlockhash('confirmed') — NUNCA usa nonce armazenado
    // Despacha: _anchorModeA ou _anchorModeB conforme options.mode ?? 'LOG'
  }

  async verifyAnchor(dltTxId: string, expectedHash: Buffer): Promise<boolean> {
    // Busca: connection.getTransaction(dltTxId)
    // Varre instruction data procurando expectedHash nos offsets de Mode A e Mode B
  }

  private async _anchorModeA(payloadHash: Buffer, eventId: string, blockhash: string, lastValidBlockHeight: number): Promise<string> {
    // Monta 88-byte instruction data (discriminator + eventId slice + payloadHash raw)
    // Cria TransactionMessage com recentBlockhash
    // sendAndConfirmTransaction com { lastValidBlockHeight, maxRetries: 3 }
  }

  private async _anchorModeB(payloadHash: Buffer, eventId: string, blockhash: string, lastValidBlockHeight: number, options?: AnchorOptions): Promise<string> {
    // Deriva PDA com seeds ["qc_anchor", eventId[0..16]]
    // Monta PDA de 97 bytes (authority + payloadHash raw + status 0x01)
    // Monta 113-byte instruction data (discriminator + unlockTimestamp i64 LE + pdaData)
    // sendAndConfirmTransaction com { lastValidBlockHeight, maxRetries: 3 }
  }
}
```

---

## 6. StellarAdapter

### Por que não usar o Memo clássico da Stellar

```
Campo Memo da Stellar clássica: 28 bytes máximo
Nosso SHA3-512:                 64 bytes

→ IMPOSSÍVEL armazenar o hash completo.
→ Hash truncado DESTRÓI a integridade criptográfica.
→ Uso de Memo clássico é BANIDO neste adapter.
```

### Soroban — Contrato nativo da Stellar

O `StellarAdapter` ancora **exclusivamente** via invocação de contrato Soroban. O contrato recebe 64 bytes raw e armazena no estado persistente ou emite evento Soroban nativo.

### Funções do contrato Soroban (referência para equipe blockchain)

```rust
// Pseudo-Soroban/Rust — interface do contrato
pub fn anchor_event(
    env: Env,
    event_id: String,      // ID interno (correlação off-chain)
    hash: Bytes,           // 64 bytes SHA3-512 raw
    unlock_timestamp: i64  // 0 se não for escrow; Unix seconds
) -> Result<(), Error>

pub fn get_anchor_hash(env: Env, event_id: String) -> Option<Bytes>
// Usada pelo Oracle de verificação pública
```

### Fluxo de envio (Soroban obriga simulação prévia)

```
1. loadAccount(keypair.publicKey())
2. contract.call('anchor_event', event_id, hash_bytes, unlock_ts)
3. TransactionBuilder → addOperation → setTimeout(30) → build()
4. sorobanServer.simulateTransaction(tx)   ← obrigatório para obter footprint
5. assembleTransaction(tx, simResult)      ← aplica footprint
6. preparedTx.sign(keypair)
7. sorobanServer.sendTransaction(preparedTx)
8. Poll sorobanServer.getTransaction(hash) até SUCCESS ou timeout (30s)
```

`setTimeout(30)` é o equivalente Stellar ao `lastValidBlockHeight` da Solana — a transação expira se não for incluída no ledger dentro de 30 segundos.

### Variáveis de ambiente

```
STELLAR_HORIZON_URL           — ex: https://horizon.stellar.org
STELLAR_SOROBAN_RPC_URL       — ex: https://soroban-rpc.stellar.org
STELLAR_AUTHORITY_SECRET_KEY  — S... (Stellar secret key)
STELLAR_ANCHOR_CONTRACT_ID    — Contract ID deployado
STELLAR_NETWORK_PASSPHRASE    — "Public Global Stellar Network ; September 2015"
```

### Dependência npm

```
@stellar/stellar-sdk  ^12.x
```

### Estrutura da classe

```typescript
// src/services/adapters/StellarAdapter.ts

export class StellarAdapter implements IDLTAdapter {
  private server: Horizon.Server
  private sorobanServer: SorobanRpc.Server
  private keypair: Keypair
  private contractId: string
  private networkPassphrase: string

  constructor() {
    // Lê todas as env vars STELLAR_*
    // Lança Error se qualquer env var estiver ausente
  }

  async anchorEvent(payloadHash: Buffer, eventId: string, options?: AnchorOptions): Promise<string> {
    // Valida: payloadHash.length === 64
    // MEMO CLÁSSICO É BANIDO — sempre usa Soroban
    // Executa o fluxo de 8 etapas (simulate → assemble → sign → send → poll)
    // Retorna sendResult.hash como TxID
  }

  async verifyAnchor(dltTxId: string, expectedHash: Buffer): Promise<boolean> {
    // sorobanServer.getTransaction(dltTxId) → verifica SUCCESS
    // sorobanServer chama get_anchor_hash(event_id) para verificação completa do hash
  }
}
```

---

## 7. `DLTAdapterFactory` — Roteamento dinâmico por Tenant

### Regra arquitetônica crítica

> `SchedulerService.start()` **NÃO** recebe adapter como parâmetro.
> A resolução da blockchain ocorre **por evento/tenant, no momento do processamento da fila** — NUNCA na inicialização do servidor.
> Um batch de 10 eventos com tenants em chains distintas ancora corretamente em cada rede no mesmo ciclo de cron.

```typescript
// src/services/DLTAdapterFactory.ts

export type SupportedChain = 'ALGORAND' | 'SOLANA' | 'STELLAR' | 'POLYGON' | 'ETHEREUM'

export class DLTAdapterFactory {
  /**
   * Retorna o adapter correto para a chain do Tenant.
   * Chamado DENTRO do loop de AnchorQueueService.processQueue(), por evento.
   * SchedulerService nunca chama getAdapter() diretamente.
   */
  static getAdapter(targetChain: SupportedChain): IDLTAdapter {
    switch (targetChain) {
      case 'ALGORAND': return new AlgorandAnchorFacet()
      case 'SOLANA':   return new SolanaAdapter()
      case 'STELLAR':  return new StellarAdapter()
      // Futuro:
      // case 'POLYGON':  return new PolygonAdapter()
      // case 'ETHEREUM': return new EthereumAdapter()
      default: throw new Error(`DLT adapter não implementado para chain: ${targetChain}`)
    }
  }
}
```

---

## 8. Atualização do `AnchorQueueService`

Três mudanças necessárias:

**1. `findMany` inclui `targetChain` do Tenant:**
```typescript
const pendingEvents = await prisma.eventLog.findMany({
  where: { ... },
  include: { tenant: { select: { targetChain: true } } },
  orderBy: { id: 'asc' },
  take: 10
})
```

**2. Agrupamento por chain para reutilizar adapter:**
```typescript
// Agrupa por chain evitando instanciar um adapter por evento
const eventsByChain = lockedEvents.reduce((acc, event) => {
  const chain = (event.tenant?.targetChain ?? 'ALGORAND') as SupportedChain
  if (!acc[chain]) acc[chain] = []
  acc[chain].push(event)
  return acc
}, {} as Record<SupportedChain, typeof lockedEvents>)
```

**3. Conversão string → Buffer e nova assinatura:**
```typescript
for (const [chain, events] of Object.entries(eventsByChain)) {
  const adapter = DLTAdapterFactory.getAdapter(chain as SupportedChain)
  for (const event of events) {
    // signatureHash é hex string no banco — converter para Buffer antes
    const payloadHash = Buffer.from(event.signatureHash!, 'hex')
    const txId = await adapter.anchorEvent(payloadHash, event.id)
    // ... atualiza EventLog com txId
  }
}
```

---

## 9. Comparativo arquitetônico

| | Algorand | Solana Mode A | Solana Mode B | Stellar |
|---|---|---|---|---|
| **Mecanismo** | Note field (zero-value txn) | Instruction Data | PDA 97 bytes | Soroban contract call |
| **Custo aprox.** | ~0.001 ALGO | ~5000 lamports | ~0.0014 SOL | ~0.0001 XLM |
| **Estado on-chain?** | Não | Não | Sim | Sim |
| **M2M readable?** | Não | Não | Sim (PDA) | Sim (view fn) |
| **EscrowFacet Time-Lock** | Não (Sub-sistema 5) | Não | Sim (`unlockTimestamp` i64) | Sim (`unlock_timestamp` i64) |
| **Memo clássico?** | N/A | N/A | N/A | **BANIDO** (limite 28b) |
| **Durable Nonces?** | N/A | **BANIDO** | **BANIDO** | N/A |

---

## 10. Variáveis de ambiente novas

| Variável | Chain | Obrigatório |
|---|---|---|
| `SOLANA_RPC_URL` | Solana | Sim |
| `SOLANA_AUTHORITY_PRIVATE_KEY` | Solana | Sim |
| `SOLANA_ANCHOR_PROGRAM_ID` | Solana | Sim |
| `STELLAR_HORIZON_URL` | Stellar | Sim |
| `STELLAR_SOROBAN_RPC_URL` | Stellar | Sim |
| `STELLAR_AUTHORITY_SECRET_KEY` | Stellar | Sim |
| `STELLAR_ANCHOR_CONTRACT_ID` | Stellar | Sim |
| `STELLAR_NETWORK_PASSPHRASE` | Stellar | default: `Public Global Stellar Network ; September 2015` |

Variáveis condicionais: o servidor não lança erro se `SOLANA_*` ou `STELLAR_*` estiverem ausentes na inicialização — apenas na primeira tentativa de instanciar o adapter correspondente. Tenant com `targetChain: SOLANA` sem as envs falhará silenciosamente na fila (DLQ).

---

## 11. Dependências npm novas

| Pacote | Versão | Uso |
|---|---|---|
| `@solana/web3.js` | `^1.95.x` | Transações Solana, PDA derivation, Connection |
| `@stellar/stellar-sdk` | `^12.x` | Soroban invocation, Horizon.Server, SorobanRpc |

---

## 12. Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `src/interfaces/IDLTAdapter.ts` | Substituir pela v2 (Buffer + AnchorOptions) |
| `src/services/core-facets/AlgorandAnchorFacet.ts` | Assinar nova interface (lógica interna preservada) |
| `src/services/AnchorQueueService.ts` | Include tenant, agrupar por chain, converter Buffer |
| `src/services/DLTAdapterFactory.ts` | Criar |
| `src/services/adapters/SolanaAdapter.ts` | Criar |
| `src/services/adapters/StellarAdapter.ts` | Criar |
| `prisma/schema.prisma` | Adicionar `targetChain String @default("ALGORAND")` ao Tenant |
| `.env.example` | Adicionar variáveis SOLANA_* e STELLAR_* (comentadas) |

---

## 13. O que NÃO está neste sub-sistema

- `EscrowFacet.lockAsset()` e campos `defaultEscrowDuration/min/max` → Sub-sistema 5
- `LOCKED_IN_ESCROW` status no enum `AssetStatus` → Sub-sistema 5
- `AgentRegistryFacet` e validação Falcon-512 de robôs → Sub-sistema 4
- `PolygonAdapter` / `EthereumAdapter` → fase 2 deste sub-sistema (após Solana e Stellar validados)
- Contratos Soroban e Programs Rust (responsabilidade da equipe blockchain)
- Tenant UI para configurar `targetChain` — responsabilidade do frontend

---

## 14. Dependências de execução

| Dependência | Status | Bloqueante? |
|---|---|---|
| Sub-sistema 1 — `SchedulerService` rodando | Spec aprovado, pendente implementação | **Sim** — sem scheduler o `AnchorQueueService` não é disparado |
| Sub-sistema 3 — Document Verification | Spec aprovado | Não — independente |
| Contratos on-chain (Solana Program + Soroban) | Responsabilidade da equipe blockchain | **Sim** — adapters precisam de Program ID e Contract ID configurados |
