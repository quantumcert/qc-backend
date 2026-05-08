# Architecture

_Generated: 2026-05-08 | Focus: arch_

## Summary

qc-backend is a Node.js/TypeScript API built as a direct adaptation of the EIP-2535 Diamond Standard. The core routing primitive is `POST /api/v1/diamond`, which dispatches by string selector to registered Facet functions. Each Facet is a pure static service class with zero Express dependencies — it receives a server-injected `secureContext` first and an opaque `payload` second. The architecture enforces strict tenant isolation, domain-agnostic universal terminology, and a pluggable DLT layer for multi-chain anchoring.

---

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                          HTTP Clients                                │
│          (API consumers, dashboard, IoT agents, public scanners)     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                         src/server.ts                                │
│  Global IP rate limiter (in-memory Map, 200 req/min/IP)              │
│  CORS whitelist, Helmet CSP, body-size limit (500kb)                 │
│  /api/v1/scan rate limiter (30 req/min/IP, no auth)                  │
│  SchedulerService.start() — registers all cron workers               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                       src/routes/index.ts                            │
│  Mounts all versioned route modules under /api                       │
│  Registers POST /v1/diamond → DiamondProxy.delegateCall              │
│  Registers GET /v1/scan → SDMVerifierService (public, no auth)       │
└──┬────────────┬──────────────┬──────────────┬───────────────┬────────┘
   │            │              │              │               │
   ▼            ▼              ▼              ▼               ▼
REST routes   Diamond      Webhook       Agent          Public
(tenants,     Proxy        Routes        Routes         Routes
 assets,      (selector-   (external     (M2M/IoT)      (verify,
 devices,     based)        payments)                    scan)
 api-keys,
 wallet,
 circuit-
 breaker)
```

### Middleware Stack (applied per-route, not global)

```text
requireApiKey           → validates X-API-Key / Bearer qc_..., injects tenantId + apiKeyId + role
tenantRateLimiter       → Postgres-backed per-plan-tier counter (RateLimiterFacet)
requireRole / RBAC      → role hierarchy ADMIN > OPERATOR > READER
requireIdempotency      → UUIDv4 header, in-memory store with 24h TTL
requireAgentSignature   → Falcon-512 payload verification for M2M agents (after requireApiKey)
```

---

## Diamond Pattern Core

### DiamondProxy (`src/diamond/DiamondProxy.ts`)

Single POST handler at `POST /api/v1/diamond`. Receives `{ selector, payload }` in body.

1. Validates selector via `Object.prototype.hasOwnProperty.call(FacetRegistry, selector)` (prototype pollution guard)
2. Builds `secureContext` exclusively from `req.tenantId`, `req.apiKeyId`, `req.apiKeyRole` (injected by middleware — never from user body)
3. Calls `FacetRegistry[selector](secureContext, req.body.payload || {})`
4. Returns `{ success: true, data, meta: { selector, executionMode: 'DELEGATE_CALL', timestamp } }`

### FacetRegistry (`src/diamond/FacetRegistry.ts`)

Static lookup table mapping selector strings to Facet static methods. All selectors follow the pattern `<domain>.<verb>`.

| Selector | Facet | Category |
|---|---|---|
| `device.register` | `DeviceRegistryFacet.registerDevice` | Hardware provisioning |
| `device.validateTap` | `DeviceGuardFacet.validateAndRecordTap` | NFC anti-replay |
| `asset.create` | `AssetRegistryFacet.createAsset` | Asset registry |
| `asset.get` | `AssetRegistryFacet.getAsset` | Asset registry |
| `asset.list` | `AssetRegistryFacet.listAssets` | Asset registry |
| `asset.update` | `AssetRegistryFacet.updateAsset` | Asset registry |
| `asset.addOwner` | `AssetRegistryFacet.addOwner` | Ownership |
| `event.recordAuthenticated` | `EventLogFacet.recordAuthenticatedEvent` | Event engine |
| `event.suggestPublic` | `EventLogFacet.suggestPublicEvent` | Curation queue |
| `event.review` | `EventLogFacet.reviewEvent` | Curation queue |
| `context.routeAssetRead` | `ContextRouterFacet.routeAssetRead` | Context routing |
| `blindContact.submit` | `BlindContactLogFacet.submitContact` | Privacy |
| `publicProfile.filter` | `PublicProfileFacet.filterAsset` | Public profile |
| `lifecycle.transition` | `LifecycleFacet.transition` | State machine |
| `transfer.initiate` | `TransferRegistryFacet.initiateTransfer` | Ownership transfer |
| `commissioning.start` | `CommissioningFacet.start` | QTAG NFC provisioning |
| `commissioning.confirm` | `CommissioningFacet.confirm` | QTAG NFC provisioning |
| `commissioning.status` | `CommissioningFacet.statusQuery` | QTAG NFC provisioning |
| `agent.register` | `AgentRegistryFacet.register` | M2M identity |
| `agent.revoke` | `AgentRegistryFacet.revoke` | M2M identity |
| `agent.status` | `AgentRegistryFacet.status` | M2M identity |
| `escrow.lock` | `EscrowFacet.lock` | Escrow time-lock |
| `escrow.release` | `EscrowFacet.release` | Escrow time-lock |
| `escrow.cancel` | `EscrowFacet.cancel` | Escrow time-lock |
| `escrow.status` | `EscrowFacet.getStatus` | Escrow time-lock |

---

## Routing Strategy (Hybrid — Option C)

| Route Type | Path Pattern | Auth | Purpose |
|---|---|---|---|
| Diamond Proxy | `POST /api/v1/diamond` | `requireApiKey` | All authenticated mutations + queries via selector |
| Semantic REST | `PATCH /api/v1/assets/:id/lifecycle`, etc. | `requireApiKey` | Explicit state-change endpoints |
| Public | `GET /api/v1/public/*`, `GET /api/v1/scan` | None | Browser/QR code accessible |
| Webhook Inbox | `POST /api/v1/webhooks/mercadopago` | Own HMAC | External payment notifications |
| Agent/M2M | `POST /api/v1/agent/event` | `requireApiKey` + `requireAgentSignature` | IoT/robot event submission |

---

## Request Flow

### Authenticated Diamond Call

```
1. HTTP POST /api/v1/diamond
2. server.ts → global IP rate limiter (in-memory Map)
3. routes/index.ts → requireApiKey middleware
   → ApiKeyManagementFacet.validateApiKey(rawKey)
   → injects { tenantId, apiKeyId, apiKeyRole } into req
4. DiamondProxy.delegateCall(req, res)
   → validates selector (prototype pollution guard)
   → builds secureContext from req (NOT req.body)
   → FacetRegistry[selector](secureContext, payload)
5. Facet executes → prisma query (always scoped by tenantId)
6. Response: { success, data, meta }
```

### Authenticated REST Call (e.g., asset creation)

```
1. HTTP POST /api/v1/assets
2. global IP rate limiter
3. requireApiKey → injects context
4. requireIdempotency → UUIDv4 header check
5. tenantRateLimiter → Postgres counter (RateLimiterFacet)
6. requireOperator → role >= OPERATOR check
7. AssetController.create → calls AssetRegistryFacet.createAsset(ctx, body)
8. Facet → prisma.asset.create (tenantId scoped)
```

### NFC Public Scan (QTAG SDM)

```
1. HTTP GET /api/v1/scan?p=<piccData>&m=<cmac>&lat=&lon=&uid=
2. server.ts → scanRateLimitMap (30 req/min/IP, unauthenticated)
3. routes/index.ts → SDMVerifierService.verifyTap(params)
4. Returns { status: 'APPROVED' | 'REJECTED', ... }
```

### Event Anchoring (Async Background)

```
1. EventLogFacet.recordAuthenticatedEvent creates EventLog with status=APPROVED, dltTxId=null
2. AnchorQueueService.processQueue() triggered fire-and-forget
3. SchedulerService (node-cron, every 30s) also triggers processQueue
4. processQueue:
   → findMany(status IN [APPROVED, PENDING_FUNDS], dltTxId=null)
   → atomic row lock (dltTxId='PROCESSING' via updateMany where dltTxId=null)
   → DLTAdapterFactory.getAdapter(tenant.targetChain)
   → adapter.anchorEvent(eventId, signatureHash)
   → update eventLog.dltTxId = txId
   → WebhookDispatcher.dispatch(tenantId, 'ANCHOR_SUCCESS', ...)
   → on failure: RetryWorker.enqueue(...)
```

---

## Layers

**HTTP Layer:**
- Location: `src/server.ts`, `src/routes/`, `src/controllers/`
- Purpose: Express app setup, route registration, controller thin-layer
- Has Express imports; never contains business logic

**Middleware Layer:**
- Location: `src/middleware/`
- Purpose: Cross-cutting: auth, RBAC, idempotency, rate limiting
- Injects `secureContext` fields into `req` — Facets trust these, never body

**Diamond Routing Layer:**
- Location: `src/diamond/`
- Purpose: Selector dispatch — the only place FacetRegistry is consumed
- DiamondProxy is the only Express-aware component calling Facets

**Facet Layer (Core Business Logic):**
- Location: `src/services/core-facets/`
- Purpose: Pure business logic, no Express imports
- Signature always: `static async method(secureContext: SecureContext, payload: T)`
- Scopes every Prisma query by `tenantId` from `secureContext`

**Service Layer (Infrastructure):**
- Location: `src/services/` (non-facet)
- Purpose: Scheduler, queue workers, crypto utilities, DLT adapters
- `SchedulerService` — cron orchestration only, no business logic
- `AnchorQueueService` — FIFO DLT anchoring with atomic row lock
- `RetryWorker` — exponential backoff retry for failed DLT operations
- `EscrowReleaseWorker` — cron-driven AUTO-mode escrow release
- `BlockchainObserverService` — incoming stablecoin deposit scanner

**DLT Adapter Layer:**
- Location: `src/services/multi-chain/`, `src/interfaces/IDLTAdapter.ts`
- Purpose: Chain-agnostic blockchain operations behind `IDLTAdapter` interface
- Adapters: `AlgorandAdapter`, `EthAdapter`, `PolygonAdapter`, `SolanaAdapter`, `SorobanAdapter`
- Factory: `DLTAdapterFactory.getAdapter(chain: SupportedChain)`
- Resolves adapter from `Tenant.targetChain` at runtime

**Data Layer:**
- Location: `src/config/prisma.ts`, `prisma/schema.prisma`
- All queries scoped by `tenantId` — cross-tenant access impossible at query level

---

## Key Abstractions

**SecureContext:**
- Purpose: Immutable tenant identity passed to every Facet
- Shape: `{ tenantId: string, apiKeyId: string, role: string }`
- Source: Injected by `requireApiKey` middleware into `req`; assembled by `DiamondProxy`; NEVER derived from user body

**IDLTAdapter (`src/interfaces/IDLTAdapter.ts`):**
- Purpose: Unified contract for all blockchain operations
- Methods: `anchorEvent`, `verifyAnchor`, `createEscrow`, `releaseEscrow`, `cancelEscrow`, `sendAsset`, `receiveAsset`
- All methods support optional `pqcProof` (Falcon-512) and `tripleSign` (Seller + Buyer + Quantum Cert)

**Asset:**
- Purpose: Domain-agnostic container; `metadata` field is a free-form JSON blob the platform never interprets
- `publicUrl` is a permanent unique URL for QR/NFC scan resolution
- `publicDataKeys` controls which `metadata` keys are exposed publicly
- Hardware binding via optional `deviceId` FK to `Device` (NFC/QTAG chip)

**EventLog:**
- Purpose: Append-only event history for an Asset
- `payload` is opaque JSON; `signatureHash` is SHA3-512(payload) used for DLT anchoring
- `status` flows: `PENDING` → `APPROVED` | `REJECTED` (curation); `APPROVED` + `dltTxId=null` → queued for anchoring
- `documentHash` holds SHA3-512 of an off-chain document (PDF, report) — enables `DocumentVerificationFacet` reverse lookup

**Device:**
- Purpose: NFC/QTAG hardware state — anti-replay guardian
- `lastCounter` is monotonically increasing; any tap with `CTR <= lastCounter` is rejected as replay/clone
- `sdmMacKeyId` / `sdmEncKeyId` are KMS-wrapped key references (never plaintext)

---

## Asset Lifecycle State Machine

```text
         ┌─────────────────────────────────────────────────────────────┐
         │                      LifecycleFacet                         │
         └─────────────────────────────────────────────────────────────┘

  DRAFT ──(ADMIN|OPERATOR)──► ACTIVE ──(ADMIN)──► SUSPENDED ──(ADMIN)──► ACTIVE
                                 │
                                 ├──(ADMIN)──► ARCHIVED
                                 │
                                 ├──(ADMIN)──► BURNED  [terminal]
                                 │
                                 ├──(TransferRegistryFacet)──► AWAITING_PAYMENT
                                 │                               │
                                 │◄──(BillingFacet, on payment)──┘
                                 │
                                 └──(EscrowFacet.lock)──► LOCKED_IN_ESCROW
                                                              │
                                                              └──(EscrowFacet.release)──► ACTIVE
```

Transition rules enforced in `LifecycleFacet` via `TRANSITION_RULES` matrix at `src/services/core-facets/LifecycleFacet.ts:16`. Assets in `LOCKED_IN_ESCROW` are protected from `LifecycleFacet` — only `EscrowFacet` can release them.

---

## Event Curation Flow (Issue #7 — Curation Layer)

```text
  Non-auditor API key
        │
        ▼
  event.suggestPublic → EventLog(status=PENDING)
                         → WebhookDispatcher → tenant notified
                               │
              ┌────────────────┴──────────────────┐
              │ Owner reviews                      │
              ▼                                    ▼
   event.review(APPROVED)              event.review(REJECTED)
   → signatureHash generated            → EventLog(status=REJECTED)
   → AnchorQueueService triggered
```

Authenticated API keys always go directly to `status=APPROVED` via `event.recordAuthenticated`.

---

## Cron Workers (SchedulerService)

| Worker | Interval | Purpose |
|---|---|---|
| `AnchorQueueService` | 30s (configurable `ANCHOR_QUEUE_INTERVAL_SECONDS`) | Anchor APPROVED events to DLT |
| `RetryWorker` | 15s | Retry failed DLT operations with exponential backoff; DLQ after 5 attempts |
| `BlockchainObserverService` | 30s (configurable `BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS`) | Scan chains for incoming stablecoin deposits |
| `SecurityWatchdogService` | 60s | Anomaly detection; writes `PanicLog` records |
| `EscrowReleaseWorker` | 60s (configurable `ESCROW_RELEASE_INTERVAL_SECONDS`) | Auto-release matured escrows |

All workers use a `isRunning` boolean lock to prevent overlapping cycles (`src/services/SchedulerService.ts`).

---

## Cryptographic Stack

| Component | Algorithm | Usage |
|---|---|---|
| `PostQuantumCrypto` (`src/utils/PostQuantumCrypto.ts`) | Falcon-512 | PQC signing for anchors and agent payload verification |
| `QuantumSignerService` (`src/services/QuantumSignerService.ts`) | Falcon-512 | QTAG commissioning — sign asset metadata during NFC encoding |
| `KMSService` (`src/services/KMSService.ts`) | AES-256-GCM wrapped master key | SDM key wrapping; never stores raw private keys |
| `CryptoService` (`src/services/CryptoService.ts`) | AES-256-GCM | Device masterKey encryption at rest |
| `QTagCryptoService` (`src/services/QTagCryptoService.ts`) | AES-128 SFI SDM | NFC CMAC computation and picc_data decryption |
| `SDMVerifierService` (`src/services/SDMVerifierService.ts`) | AES-128 CMAC | Public NFC tap validation and anti-replay enforcement |
| EventLog SHA3-512 | SHA3-512 | `signatureHash` = hash of `payload` JSON; anchored on-chain |

---

## Authentication Model

- API keys use prefix `qc_`, stored as bcrypt hashes (`ApiKey.keyHash`)
- Raw key shown only at creation time
- Dual extraction: `X-API-Key: qc_...` (primary) or `Authorization: Bearer qc_...` (fallback)
- Role hierarchy: `ADMIN (3) > OPERATOR (2) > READER (1)` (`src/types/index.ts:34`)
- M2M agents: `Agent` model links to an `ApiKey` (role=OPERATOR) + stores Falcon-512 public key; `requireAgentSignature` validates payload signature before DiamondProxy dispatch

---

## Error Handling

**Strategy:** Structured error objects with `code` + `httpStatus` properties thrown from Facets; caught by `DiamondProxy.delegateCall` and mapped to HTTP responses.

**Pattern:**
```typescript
// In Facets (e.g. LifecycleFacet.ts:22):
function makeError(message: string, code: string, httpStatus: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.httpStatus = httpStatus;
    return err;
}
```

Known business errors (`error.code && error.message`) → 400 with `{ success: false, error, code }`.
Unknown errors → 500 with sanitized `{ success: false, error: 'Internal Server Error', code: 'E500' }` (prevents information disclosure).

**Global Express error handler:** `src/middleware/errorHandler.ts`.

---

## Tenant Isolation Guarantee

Every Facet receives `tenantId` from `secureContext` (server-injected, never from body). All Prisma queries include `where: { ..., tenantId }`. Cross-tenant reads are structurally impossible at the query level. Idempotency keys are namespaced as `${tenantId}:${idempotencyKey}` to prevent cross-tenant guessing.

---

## Anti-Patterns

### Passing tenant context via request body
**What happens:** DiamondProxy ignores any `tenantId` in `req.body.payload`
**Why it's wrong:** Would enable IDOR — any caller could impersonate another tenant
**Do this instead:** Always read `secureContext.tenantId` injected by `requireApiKey`

### Calling Facets directly from other Facets with user-supplied context
**What happens:** Some internal cross-Facet calls exist (e.g., `AnchorQueueService` calls `DLTAdapterFactory` directly)
**Why it's wrong:** Bypasses the middleware-enforced `secureContext` contract
**Do this instead:** Internal service calls pass tenant data resolved from DB, not from user input

### Storing secrets in plaintext in DB
**What happens:** `Device.sdmMacKeyId` and `Device.sdmEncKeyId` store KMS key IDs, not raw keys
**Why it's right:** `KMSService` wraps all key material; `MasterKey` model tracks only public key hash

---

## Gaps / Unknowns

- `idempotencyStore` is in-memory (`src/middleware/idempotencyGuard.ts:8`) — not shared across processes; requires Redis for multi-instance deployments
- `ipRateLimitMap` in `server.ts` is also in-memory — same multi-instance concern
- `CommissioningFacet.start` has a hardcoded `tenantSecretHex = Buffer.alloc(64, 0)` in non-production — production KMS path is `TODO` (`src/services/core-facets/CommissioningFacet.ts:51`)
- `PolygonAdapter` has incomplete initialization guard in `DLTAdapterFactory` — falls through to `new PolygonAdapter()` even if KMS check fails in certain code paths
- `DocumentVerificationFacet` is registered in `core-facets/` but not yet mapped in `FacetRegistry`
- `NfcValidationFacet` is referenced in `types/index.ts` constants but not in `FacetRegistry`
