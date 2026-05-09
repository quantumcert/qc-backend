# Architecture Research

**Domain:** Multi-tenant backend — pluggable DLT adapters, post-quantum crypto, cron workers, IoT/M2M event ingestion, Diamond pattern (EIP-2535 Node.js adaptation)
**Researched:** 2026-05-08
**Confidence:** HIGH (derived from direct codebase mapping + verified library docs)

---

## Standard Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         HTTP Clients                                   │
│   (API tenants, qc-dashboard, qc-record-module, IoT agents, scanners) │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
┌────────────────────────────────────▼───────────────────────────────────┐
│                       HTTP / Middleware Layer                           │
│  IP rate limiter (in-memory) │ CORS/Helmet │ Body size limit (500kb)   │
│  requireApiKey → injects secureContext (tenantId, apiKeyId, role)      │
│  tenantRateLimiter (Postgres-backed) │ RBAC │ Idempotency guard        │
└───┬──────────────┬──────────────┬───────────────┬───────────────┬──────┘
    │              │              │               │               │
    ▼              ▼              ▼               ▼               ▼
Diamond        REST           Webhook         Agent/M2M       Public
Proxy          Routes         Inbox           Routes          Routes
(selector)     (semantic      (HMAC-          (Falcon-512     (no auth,
               state changes)  validated)      payload sig)    QR/NFC)
    │              │              │               │
    └──────────────┴──────────────┴───────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                         Facet Layer (Core)                             │
│  Pure static service classes. No Express. No HTTP.                     │
│  Signature: static async method(secureContext, payload)                │
│  All Prisma queries scoped by secureContext.tenantId                   │
│                                                                        │
│  AssetRegistryFacet │ LifecycleFacet │ EventLogFacet                  │
│  EscrowFacet │ TransferRegistryFacet │ AgentRegistryFacet              │
│  CommissioningFacet │ DeviceGuardFacet │ DocumentVerificationFacet    │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                     Infrastructure Services                            │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SchedulerService (node-cron)                                    │  │
│  │  AnchorQueueService (30s) │ RetryWorker (15s, exp backoff + DLQ) │  │
│  │  EscrowReleaseWorker (60s) │ BlockchainObserverService (30s)     │  │
│  │  SecurityWatchdogService (60s)                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Crypto Stack                                                    │  │
│  │  PostQuantumCrypto (Falcon-512) │ KMSService (AES-256-GCM wrap)  │  │
│  │  QTagCryptoService (AES-128 SFI SDM) │ SDMVerifierService        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                       DLT Adapter Layer                                │
│                                                                        │
│  IDLTAdapter (interface — the only contract between core and chains)   │
│                                                                        │
│  DLTAdapterFactory.getAdapter(tenant.targetChain)                      │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────────┐  │
│  │  Algorand   │ │    Stellar   │ │    Solana   │ │  Eth/Polygon   │  │
│  │  Adapter    │ │  (Soroban)   │ │   Adapter   │ │   Adapters     │  │
│  │  (primary)  │ │   Adapter    │ │  (planned)  │ │  (scaffolded)  │  │
│  └─────────────┘ └──────────────┘ └─────────────┘ └────────────────┘  │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                         Data Layer                                     │
│  Prisma ORM → PostgreSQL                                               │
│  All queries include: where: { ..., tenantId }  (cross-tenant = 0)    │
│  Models: Tenant │ Asset │ EventLog │ Device │ Agent │ EscrowRecord     │
│          ApiKey │ PendingTransaction │ ChainTransaction │ PanicLog     │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Boundary Rule |
|-----------|----------------|---------------|
| `DiamondProxy` | Selector dispatch; builds `secureContext` from `req` (never body) | Only Express-aware caller of Facets |
| `FacetRegistry` | Static map of `domain.verb` → Facet static method | Adding a capability = adding one entry here |
| Core Facets (`core-facets/`) | Pure business logic; all queries scoped by `tenantId` | No Express, no HTTP, no chain-specific code |
| `IDLTAdapter` | Unified contract for all blockchain operations | Core never speaks to chains directly — only through this interface |
| `DLTAdapterFactory` | Runtime chain resolution from `tenant.targetChain` | All chain instantiation goes here; KMS key retrieval here |
| Chain Adapters (`multi-chain/`) | Chain-specific transaction construction and submission | Only place that imports chain SDKs (`algosdk`, `@stellar/stellar-sdk`, `@solana/web3.js`) |
| `AnchorQueueService` | FIFO batch anchoring of `EventLog` records with `dltTxId=null` | Groups by chain to minimize adapter instantiations; atomic row lock prevents duplicate processing |
| `RetryWorker` | Exponential backoff retry for failed DLT ops; DLQ after 5 attempts | Reads from `PendingTransaction`; never retries inline |
| `EscrowReleaseWorker` | Cron-driven AUTO-mode escrow maturity check and release | Calls `EscrowFacet.release` internally; no direct DLT calls |
| `SchedulerService` | Cron orchestration only — no business logic | Each worker has `isRunning` boolean lock to prevent overlap |
| `KMSService` | Key wrapping via AES-256-GCM; never stores raw key material | All adapters retrieve secrets here; no direct `process.env` access in adapters |
| `PostQuantumCrypto` | Falcon-512 sign/verify (`falcon-crypto` package) | Used by adapters (embed in note/contract arg), by `AgentRegistryFacet` (verify M2M payloads), and by `CommissioningFacet` |
| `SDMVerifierService` | NFC tap validation (CMAC + anti-replay counter) | Public endpoint — no auth; reads device state from DB |
| `WebhookDispatcher` | B2B tenant webhook fire-and-forget | Called after anchor success/failure and curation events |

---

## Recommended Project Structure

The current structure is sound. The key organizational principle is horizontal separation by technical concern at the top level, with vertical sub-division inside `services/`:

```
src/
├── server.ts                  # Startup, global middleware, SchedulerService.start()
├── config/
│   ├── env.ts                 # Env var parsing + validation
│   └── prisma.ts              # Prisma singleton (import everywhere, never re-instantiate)
├── diamond/
│   ├── DiamondProxy.ts        # The one POST /api/v1/diamond handler
│   └── FacetRegistry.ts       # selector → Facet function lookup (add here for new Facets)
├── interfaces/
│   └── IDLTAdapter.ts         # The only contract between core and DLT layer
├── middleware/                # Cross-cutting: auth, RBAC, idempotency, rate limit, agent sig
├── routes/v1/                 # Thin route composition — middleware chain + controller call
├── controllers/               # Thin HTTP adapters — extract req fields, call Facets, return res
├── services/
│   ├── core-facets/           # PURE business logic. No Express. No chain SDK imports.
│   ├── multi-chain/           # Chain adapters. Only place chain SDKs are imported.
│   │   ├── types.ts           # Shared multi-chain types (TripleSignPayload, etc.)
│   │   ├── AlgorandAdapter.ts
│   │   ├── SorobanAdapter.ts  # Stellar — uses @stellar/stellar-sdk (NOT legacy js-soroban-client)
│   │   ├── SolanaAdapter.ts
│   │   ├── EthAdapter.ts
│   │   └── PolygonAdapter.ts
│   ├── DLTAdapterFactory.ts   # Singleton factory; getAdapter(chain) → IDLTAdapter
│   ├── AnchorQueueService.ts  # FIFO + atomic lock + chain grouping
│   ├── RetryWorker.ts         # Exp backoff + DLQ (PendingTransaction table)
│   ├── EscrowReleaseWorker.ts # Cron-driven AUTO-mode escrow release
│   ├── BlockchainObserverService.ts  # Incoming stablecoin deposit scanner
│   ├── SchedulerService.ts    # node-cron wiring; all workers registered here
│   ├── KMSService.ts          # Key wrapping
│   ├── QuantumSignerService.ts # Falcon-512 for QTAG commissioning
│   ├── QTagCryptoService.ts   # AES-128 SFI SDM CMAC
│   └── SDMVerifierService.ts  # Public NFC tap validation
├── types/index.ts             # AuthenticatedRequest, ApiResponse, RBAC_HIERARCHY
└── utils/
    ├── PostQuantumCrypto.ts   # Falcon-512 sign/verify (falcon-crypto package)
    └── WebhookDispatcher.ts   # B2B fire-and-forget
```

### Structure Rationale

- **`core-facets/` isolation:** Facets have zero chain SDK imports. Swapping Algorand → Soroban requires zero Facet changes.
- **`multi-chain/` isolation:** Chain SDKs (`algosdk`, `@stellar/stellar-sdk`, `@solana/web3.js`) are imported nowhere else. Dependency graph is clean.
- **`IDLTAdapter` as the seam:** `AnchorQueueService`, `RetryWorker`, and `EscrowFacet` call the adapter through the interface. Adding a chain = one new file in `multi-chain/` + one line in `DLTAdapterFactory`.
- **`DLTAdapterFactory` as the single instantiation point:** KMS key validation happens here. Chain-specific env var checks are centralized, not scattered across adapters.

---

## Architectural Patterns

### Pattern 1: Ports and Adapters (Hexagonal) for Multi-Chain

**What:** `IDLTAdapter` is the "port" — a stable interface defined in core. Each chain adapter is a "adapter" — an implementation plugged in at the factory boundary. Core business logic never knows which chain it is talking to.

**When to use:** Every time a new chain is added. The pattern is already in place; just implement the interface.

**Trade-offs:**
- Pro: Zero changes to `AnchorQueueService`, `EscrowFacet`, or any Facet when adding chains.
- Pro: Chain adapters are independently testable by mocking `IDLTAdapter`.
- Con: All chains must expose `anchorEvent`, `verifyAnchor`, `createEscrow`, `releaseEscrow`, `cancelEscrow`, `sendAsset`, `receiveAsset`. Chains with fundamentally different capabilities (e.g., chains without smart contract escrow support) require a stub or shim that throws a descriptive error.

**Practical note for Soroban:** Unlike Algorand (note field, max 1024 bytes), Soroban requires a deployed smart contract. The `STELLAR_ANCHOR_CONTRACT_ID` env var points to that contract. The adapter calls `contract.call('anchor_event', ...)` via `@stellar/stellar-sdk` (NOT the deprecated `js-soroban-client`). Node 20+ required.

```typescript
// Adding a new chain — the only required change
// src/services/DLTAdapterFactory.ts
case 'NEW_CHAIN':
  return new NewChainAdapter(); // implements IDLTAdapter

// src/services/multi-chain/NewChainAdapter.ts
export class NewChainAdapter implements IDLTAdapter {
  async anchorEvent(eventId: string, hash: string, options?: AnchorOptions): Promise<string> { ... }
  async verifyAnchor(txId: string): Promise<boolean> { ... }
  async createEscrow(params: EscrowParams): Promise<string> { ... }
  async releaseEscrow(escrowId: string, txRef: string): Promise<string> { ... }
  async cancelEscrow(escrowId: string, txRef: string): Promise<string> { ... }
  async sendAsset(params: TransferParams): Promise<string> { ... }
  async receiveAsset(params: ReceiveParams): Promise<string> { ... }
}
```

### Pattern 2: Transactional Outbox for DLT Anchoring

**What:** The `EventLog` table itself acts as the outbox. Records created with `dltTxId=null` represent "pending work." `AnchorQueueService` polls for these records, locks them atomically (`dltTxId='PROCESSING'`), anchors, and writes the resulting `txId` back.

**When to use:** Whenever an HTTP request creates work that must be durably handed off to a background process. The pattern guarantees the event is persisted before anchoring is attempted — no fire-and-forget race condition.

**Trade-offs:**
- Pro: Survives process crashes. On restart, `dltTxId=null` records are still there.
- Pro: Atomic row lock (`updateMany where dltTxId=null`) prevents duplicate anchoring across concurrent workers.
- Con: `dltTxId='PROCESSING'` sentinel requires cleanup logic if the process crashes mid-batch (currently: on next startup, `PROCESSING` rows are treated as stale — should add a timeout-based reset).
- Con: Postgres polling (30s interval) adds latency. For sub-second SLA, replace with Redis pub/sub or a message broker (BullMQ).

**Chain grouping optimization:** `AnchorQueueService` groups locked events by `tenant.targetChain` before calling `DLTAdapterFactory.getAdapter()`. This prevents re-instantiating an adapter for every event in a batch that all belong to the same chain.

### Pattern 3: Exponential Backoff + Dead Letter Queue for DLT Failures

**What:** When an adapter call fails (network error, insufficient funds, node unavailable), `AnchorQueueService` writes a `PendingTransaction` record. `RetryWorker` (15s interval) picks it up and re-attempts with exponential backoff. After 5 attempts, the record enters DLQ state and alerts are triggered.

**When to use:** All DLT-bound operations. Blockchain nodes are unreliable (congestion, rate limits, chain halts). Never retry inline — always via the `RetryWorker` path.

**Trade-offs:**
- Pro: Prevents thundering herd during chain congestion (all tenants retrying simultaneously).
- Pro: DLQ provides auditability for manual intervention.
- Con: Retry state lives in Postgres, not a dedicated message broker. This works for current scale; at high volume, BullMQ backed by Redis is the natural upgrade.

### Pattern 4: Dual-Layer Signature (Hybrid PQC)

**What:** Every anchor embeds two layers of cryptographic proof: (1) Classical EdDSA/ECDSA via the chain's native transaction signing (transport layer — protects against network tampering today), and (2) Falcon-512 PQC signature embedded in the chain-specific payload field (protects the payload against future quantum attacks).

**When to use:** All event anchoring and escrow operations. The `pqcProof` field in `AnchorOptions` carries the Falcon-512 Base64 signature.

**Chain-specific embedding:**
- Algorand: `note` field (base64, max 1024 bytes): `QC| + tenantSHA256 + eventSHA3 + Falcon512Sig`
- Soroban: Contract invocation argument (passed as `args.push(nativeToScVal(pqcProof, { type: 'string' }))`)
- Solana: Mode A (instruction data) or Mode B (PDA storage), selected via `AnchorOptions.mode`

**Trade-offs:**
- Pro: Post-quantum durability without requiring chain-level PQC support.
- Pro: Verification is chain-agnostic: recompute `SHA3-512(payload)`, verify Falcon signature, check chain tx exists.
- Con: Increases transaction size. Algorand note field limit (1024 bytes) constrains combined payload size.

### Pattern 5: Agent Registry + Middleware Signature Guard for M2M/IoT

**What:** IoT devices and robots are registered as `Agent` records linked to a tenant `ApiKey` (role=OPERATOR). Each agent has a Falcon-512 public key stored in the DB. The `requireAgentSignature` middleware verifies the Falcon-512 signature of the request payload before it reaches the DiamondProxy or agent routes.

**When to use:** `POST /api/v1/agent/event` — any event ingestion from a non-human caller where payload authenticity must be cryptographically guaranteed.

**Data flow for M2M event ingestion:**
```
IoT Device
  → POST /api/v1/agent/event
    headers: X-API-Key: qc_<agentKey>
    body: { agentId, payload, falconSignature }
  → requireApiKey (validates key, injects tenantId + role)
  → requireAgentSignature (loads Agent.publicKey, verifies Falcon-512 sig over payload)
  → AgentController → EventLogFacet.recordAuthenticatedEvent(secureContext, { ...payload, source: 'AGENT' })
  → EventLog created (status=APPROVED, dltTxId=null)
  → AnchorQueueService picks up on next 30s cycle
```

**Trade-offs:**
- Pro: End-to-end verifiability — the anchor on-chain includes the Falcon-512 proof that the device signed the payload.
- Pro: Agent keys are rotatable without changing the device hardware — update the public key in the DB.
- Con: Device must have a Falcon-512 key pair provisioned at manufacturing/commissioning time. `CommissioningFacet` handles this for QTAGs; custom IoT devices need their own provisioning flow.

### Pattern 6: Cron Worker with isRunning Guard

**What:** Every background worker in `SchedulerService` is protected by a per-worker `isRunning` boolean that is set to `true` at the start of a cycle and cleared in a `finally` block. If a previous cycle is still running, the new tick is skipped.

**When to use:** All cron workers that make external calls (DLT nodes, Postgres). Node.js is single-threaded but async gaps mean a slow DLT call can leave a cycle running past the next cron tick.

```typescript
// Pattern used by all workers in SchedulerService
let isRunning = false;
cron.schedule('*/30 * * * * *', async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    await WorkerService.processQueue();
  } finally {
    isRunning = false;
  }
});
```

### Pattern 7: Escrow / Time-Lock Oracle via Backend Authority

**What:** The `EscrowFacet` creates an `LOCKED_IN_ESCROW` asset state and writes `unlockTimestamp` to the DB. `EscrowReleaseWorker` (60s interval) scans for matured escrows and calls `EscrowFacet.release`, which dispatches `adapter.releaseEscrow()` to the target chain.

**Why not use a smart contract oracle directly:** For chains that support on-chain timelocks natively (Soroban, Ethereum), the adapter's `createEscrow` submits the unlock time to the contract. But the backend `EscrowReleaseWorker` serves as the trigger that monitors expiry and calls `releaseEscrow` — it acts as the "oracle" that signals the chain when conditions are met.

**Triple-signature requirement:** Production escrow release requires `TripleSignPayload` — seller sig + buyer sig + Quantum Cert Falcon-512 seal. All three must be present and valid before `releaseEscrow` is dispatched to the chain.

```
EscrowFacet.lock(ctx, { assetId, unlockTimestamp, ... })
  → Asset.status = LOCKED_IN_ESCROW
  → EscrowRecord created (status=LOCKED, unlockTimestamp)
  → adapter.createEscrow(params) → chain txId stored

EscrowReleaseWorker (60s cron)
  → findMany EscrowRecord where status=LOCKED AND unlockTimestamp <= now()
  → EscrowFacet.release(systemCtx, { escrowId })
    → validate TripleSignPayload
    → adapter.releaseEscrow(escrowId, txRef)
    → Asset.status = ACTIVE
    → EscrowRecord.status = RELEASED
```

---

## Data Flow

### Anchoring Queue — Full Cycle

```
HTTP Request (any authenticated route)
    ↓
Facet creates EventLog (status=APPROVED, dltTxId=null, signatureHash=SHA3-512(payload))
    ↓
AnchorQueueService.processQueue() — triggered fire-and-forget + 30s cron
    ↓
findMany EventLog where status IN [APPROVED, PENDING_FUNDS] AND dltTxId=null
    ↓
Atomic row lock: updateMany where dltTxId=null → dltTxId='PROCESSING'
    ↓
Resolve tenant.targetChain for locked events
    ↓
Group by chain → one adapter instantiation per chain per batch
    ↓
DLTAdapterFactory.getAdapter(chain) → IDLTAdapter
    ↓
adapter.anchorEvent(eventId, signatureHash, { pqcProof })
    ↓
[SUCCESS] EventLog.dltTxId = txId
          WebhookDispatcher → tenant notified (ANCHOR_SUCCESS)
[FAILURE — insufficient funds] EventLog.dltTxId=null, status=PENDING_FUNDS
[FAILURE — other] RetryWorker.enqueue(PendingTransaction)
                   EventLog.dltTxId='RETRY_QUEUED'
                   WebhookDispatcher → tenant notified (ANCHOR_RETRY_QUEUED)
```

### M2M Event Ingestion Flow

```
IoT Agent (device with Falcon-512 key)
    ↓
POST /api/v1/agent/event
  { agentId, payload: { ... }, falconSignature: "<base64>" }
  headers: X-API-Key: qc_<key>
    ↓
requireApiKey → validates key → injects { tenantId, apiKeyId, role=OPERATOR }
    ↓
requireAgentSignature → loads Agent.publicKey from DB → PostQuantumCrypto.verify(payload, sig, pubKey)
    ↓ (verified)
AgentController → EventLogFacet.recordAuthenticatedEvent(secureContext, enrichedPayload)
    ↓
EventLog created (status=APPROVED, dltTxId=null)
    ↓
[proceeds through Anchoring Queue — identical path to human-originated events]
```

### Curation Flow (Non-Auditor Contributions)

```
Non-auditor API key
    ↓
event.suggestPublic → EventLog(status=PENDING, dltTxId=null)
    ↓
WebhookDispatcher → tenant notified (CURATION_PENDING)
    ↓
Owner / Auditor: event.review({ eventId, decision: 'APPROVED' | 'REJECTED' })
    ↓
[APPROVED] signatureHash generated → EventLog.status=APPROVED
           → AnchorQueueService picks up on next cycle
[REJECTED] EventLog.status=REJECTED → no anchoring
```

### NFC Tap (SDM Public Scan)

```
NFC reader / browser (no auth)
    ↓
GET /api/v1/scan?p=<piccData>&m=<cmac>&uid=<uid>&lat=&lon=
    ↓
server.ts → scanRateLimitMap (30 req/min/IP — separate from auth rate limiter)
    ↓
SDMVerifierService.verifyTap(params)
  → QTagCryptoService.decryptPiccData(p, macKey) → deviceId + counter
  → Device.lastCounter check (CTR <= lastCounter → REJECTED as replay/clone)
  → CMAC verify
  → Device.lastCounter = CTR (monotonic update)
    ↓
Response: { status: 'APPROVED' | 'REJECTED', assetId, publicData }
```

---

## Component Boundaries (What Talks to What)

| Caller | May call | Must NOT call |
|--------|----------|---------------|
| `DiamondProxy` | `FacetRegistry` entries, reads `req` fields injected by middleware | Prisma directly, chain adapters directly |
| Core Facets | `prisma`, `PostQuantumCrypto`, other service classes (non-facet), other facets (via internal service path only — not via DiamondProxy) | Express, chain adapters, HTTP client |
| `AnchorQueueService` | `DLTAdapterFactory`, `RetryWorker`, `WebhookDispatcher`, `prisma` | Core facets (business logic belongs in facets), Express |
| Chain Adapters | `KMSService`, `PostQuantumCrypto`, `prisma` (for `ChainTransaction` logging) | Core facets, Express, other chain adapters |
| `SchedulerService` | `AnchorQueueService`, `RetryWorker`, `EscrowReleaseWorker`, `BlockchainObserverService`, `SecurityWatchdogService` | Prisma directly, chain adapters directly |
| `EscrowReleaseWorker` | `EscrowFacet` (internal method call, not via DiamondProxy), `DLTAdapterFactory` | Express, RBAC middleware |
| Middleware | `ApiKeyManagementFacet` (for key validation), `prisma` (for rate limiter) | Core facets (except ApiKeyManagementFacet), chain adapters |

---

## Build Order for DLT Adapters

Given the constraint that the Stellar hackathon is active and Soroban is priority:

**Order 1 — Soroban/Stellar (ACTIVE, hackathon deadline)**
- `SorobanAdapter` exists in `multi-chain/` and implements `IDLTAdapter` fully.
- Dependency: `STELLAR_ANCHOR_CONTRACT_ID` requires a deployed Soroban contract. Contract deployment is a prerequisite.
- Uses `@stellar/stellar-sdk` (confirmed current SDK; `js-soroban-client` is deprecated).
- Risk: Soroban contract `anchor_event` function signature must match what the adapter calls. Contract ABI changes = adapter changes.

**Order 2 — Solana**
- `SolanaAdapter` is scaffolded in `multi-chain/`. Mode A (instruction data) or Mode B (PDA) — mode selectable via `AnchorOptions.mode`.
- Mode A (LOG): Simpler, no on-chain storage, lower fees. Suitable for simple proof-of-existence.
- Mode B (PDA): Stores hash in a Program Derived Address — on-chain retrievable but more complex and higher cost.
- Recommendation: Start with Mode A for anchoring; Mode B only if on-chain queryability from Solana contracts is required.

**Order 3 — Ethereum / Polygon**
- Adapters scaffolded. Lower urgency — no active hackathon.
- `PolygonAdapter` has an incomplete KMS initialization guard in `DLTAdapterFactory` (known gap — falls through to `new PolygonAdapter()` even if KMS check fails). Must fix before enabling.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (single process) | In-memory idempotency store + IP rate limiter. Works for single Dokploy instance. |
| Multi-instance (horizontal scale) | `idempotencyStore` must move to Redis (currently in-memory — breaks across instances). `ipRateLimitMap` same issue. No other structural changes needed — Postgres row locking in `AnchorQueueService` already handles multi-worker safety. |
| High anchor throughput (1000+ events/min) | Replace Postgres-poll-based `AnchorQueueService` with BullMQ (Redis-backed). Retains same `IDLTAdapter` contract — only the queue mechanism changes. |
| Multi-region | Prisma + Postgres stays single region (strong consistency required for atomic row lock). Workers can run in multiple regions if pointed at the same DB. Chain adapter calls are stateless — safe to distribute. |

### Scaling Priorities

1. **First bottleneck:** In-memory idempotency and rate-limit state breaks on second instance. Fix = Redis for both stores (one PR, no architecture change).
2. **Second bottleneck:** Postgres polling for `AnchorQueueService` at high event volume. Fix = BullMQ queue with `IDLTAdapter` as the job processor — interface unchanged, queue mechanism swapped.

---

## Anti-Patterns

### Anti-Pattern 1: Chain SDK Imports in Core Facets

**What people do:** Import `algosdk` or `@stellar/stellar-sdk` directly inside a Facet to "shortcut" the adapter layer.
**Why it's wrong:** Creates chain coupling in business logic. Swapping or adding chains requires touching every Facet that imported the SDK.
**Do this instead:** All chain operations go through `IDLTAdapter`. If a Facet needs a chain operation, it calls a service that calls the adapter factory — never the SDK directly.

### Anti-Pattern 2: Tenant Context from Request Body

**What people do:** Pass `tenantId` in `payload` and read it in the Facet.
**Why it's wrong:** IDOR vulnerability — any caller could impersonate another tenant by putting a different `tenantId` in the body. `DiamondProxy` discards any `tenantId` in `req.body.payload`.
**Do this instead:** Always read `secureContext.tenantId` injected by `requireApiKey`. It is structurally impossible to spoof because the middleware sets it from the DB-validated API key.

### Anti-Pattern 3: Inline DLT Retry

**What people do:** Wrap `adapter.anchorEvent()` in a try/catch retry loop inside `AnchorQueueService`.
**Why it's wrong:** Blocks the queue cycle for the duration of retries. A chain node outage blocks all other events behind the failing one.
**Do this instead:** On failure, write to `PendingTransaction` (DLQ entry) and let `RetryWorker` handle backoff asynchronously. The queue cycle finishes, processes other events, and returns.

### Anti-Pattern 4: New DLT Adapter Without `isRunning` Guard on Workers

**What people do:** Add a new chain's BlockchainObserver without the guard, assuming a 30s interval is safe.
**Why it's wrong:** If the observer takes 35s (slow node response), two cycles overlap. Double-processing of incoming deposits is a financial error.
**Do this instead:** Every worker registered in `SchedulerService` must use the `isRunning` boolean pattern (see Pattern 6 above).

### Anti-Pattern 5: Polling for Soroban Transaction Status Synchronously

**What people do:** After `sorobanServer.sendTransaction()`, poll `getTransaction()` in a loop inside the adapter until `status === 'SUCCESS'`.
**Why it's wrong:** Soroban transactions are async. Polling blocks the current event processing for seconds. Chain congestion turns a 30s queue cycle into an indefinite hang.
**Do this instead:** `anchorEvent()` returns the `txHash` immediately after submission (`PENDING` status). `verifyAnchor()` is called separately by a verification worker when needed. The `logTransaction()` call writes `status: 'PENDING'`; `BlockchainObserverService` updates it when the tx confirms.

### Anti-Pattern 6: Committing KMS Keys to Source Control

**What people do:** Hardcode secrets in adapter constructors (e.g., `const secretKey = 'SXXX...'`).
**Why it's wrong:** Commits expose the Omnibus wallet. All tenant funds are at risk.
**Do this instead:** All key retrieval goes through `KMSService.getInstance().getKey(chain, keyType)`. The `CommissioningFacet` has a known `TODO` for this (`tenantSecretHex = Buffer.alloc(64, 0)` in non-production) — this must be replaced before production deploy.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Algorand node (`ALGOD_SERVER`) | HTTP via `algosdk` inside `AlgorandAdapter` | Omnibus wallet model — master key from env |
| Stellar Horizon + Soroban RPC | HTTP via `@stellar/stellar-sdk` (Horizon.Server + SorobanRpc.Server) | Two endpoints required: `STELLAR_HORIZON_URL` + `STELLAR_SOROBAN_RPC_URL`. Contract ID required: `STELLAR_ANCHOR_CONTRACT_ID` |
| Solana RPC | HTTP via `@solana/web3.js` inside `SolanaAdapter` | Mode A vs B selectable per-call |
| MercadoPago | Webhook HMAC-validated (`POST /api/v1/webhooks/mercadopago`) | No `requireApiKey` — uses own signature validation. `BillingFacet` handles payment confirmation → asset ACTIVE |
| Tenant B2B webhooks | Fire-and-forget HTTP POST via `WebhookDispatcher` | No retry on dispatch failure. Tenant configures `webhookUrl` in `Tenant` model |

### Internal Boundaries

| Boundary | Communication | Constraint |
|----------|---------------|------------|
| Facets ↔ DLT adapters | Facets do NOT call adapters directly. `AnchorQueueService` or `EscrowReleaseWorker` calls adapters. | Facets trigger async work by creating `EventLog` or `EscrowRecord` records; the queue picks them up. |
| `EscrowReleaseWorker` ↔ `EscrowFacet` | Direct method call (not via DiamondProxy). `systemCtx` is constructed internally with `tenantId` resolved from the escrow record. | Must not bypass `tenantId` scoping. |
| `AnchorQueueService` ↔ `RetryWorker` | `RetryWorker.enqueue()` called from `AnchorQueueService` on failure. | `RetryWorker` reads `PendingTransaction`; both are Postgres-backed — no message broker needed at current scale. |
| `SchedulerService` ↔ workers | Direct method calls (`WorkerService.processQueue()`), guarded by `isRunning` boolean. | Workers are not imported by anything other than `SchedulerService`. |
| `requireAgentSignature` ↔ `Agent` model | Middleware loads `Agent.publicKey` from Prisma by `agentId` in request body. | Fails fast (403) if agentId not found or signature invalid. |

---

## Gaps / Known Issues Requiring Attention

| Gap | Severity | Fix |
|-----|----------|-----|
| `idempotencyStore` in-memory | High for multi-instance | Replace with Redis-backed store before horizontal scaling |
| `ipRateLimitMap` in-memory | High for multi-instance | Same Redis fix |
| `CommissioningFacet` hardcoded `tenantSecretHex` | High for production | Replace with `KMSService.getKey()` call — marked as TODO |
| `PolygonAdapter` KMS check fallthrough | Medium | Add explicit guard before `new PolygonAdapter()` in factory |
| `DocumentVerificationFacet` not in `FacetRegistry` | Medium | Add `document.verify` selector to `FacetRegistry.ts` |
| `NfcValidationFacet` missing from `FacetRegistry` | Low | Add selector or remove unused constant from `types/index.ts` |
| `dltTxId='PROCESSING'` orphan on crash | Medium | Add startup reset: `updateMany where dltTxId='PROCESSING' AND updatedAt < (now - timeout)` |
| Soroban tx confirmation is async | Medium | `SorobanAdapter.anchorEvent` returns `PENDING` hash; need `BlockchainObserverService` to confirm status and update `ChainTransaction` |

---

## Sources

- Codebase direct mapping: `src/interfaces/IDLTAdapter.ts`, `src/services/AnchorQueueService.ts`, `src/services/DLTAdapterFactory.ts`, `src/services/multi-chain/SorobanAdapter.ts`, `src/diamond/FacetRegistry.ts`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`
- [@stellar/stellar-sdk official docs](https://stellar.github.io/js-stellar-sdk/) — confirmed current SDK (HIGH confidence); `js-soroban-client` deprecated in favor of unified `@stellar/stellar-sdk`
- [Stellar Soroban contract invocation guide](https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk) — confirmed `Operation.invokeHostFunction` / `contract.call()` pattern
- [Hexagonal (Ports and Adapters) architecture for multi-chain](https://hedera.com/blog/pragmatic-blockchain-design-patterns-integrating-blockchain-into-business-processes/) — MEDIUM confidence (WebSearch verified with codebase alignment)
- [Transactional Outbox pattern — Postgres-backed](https://dev.to/sagarmaheshwary/transactional-outbox-with-rabbitmq-part-2-handling-retries-dead-letter-queues-and-observability-4h19) — MEDIUM confidence
- [Queue-based exponential backoff + DLQ](https://dev.to/andreparis/queue-based-exponential-backoff-a-resilient-retry-pattern-for-distributed-systems-37f3) — MEDIUM confidence
- [IoT event-driven ingestion patterns](https://medium.com/@prashunjaveri/architectural-patterns-for-iot-event-driven-architectures-557be35fa626) — MEDIUM confidence

---
*Architecture research for: qc-backend — multi-tenant Node.js backend, pluggable DLT adapters, post-quantum crypto, Diamond pattern*
*Researched: 2026-05-08*
