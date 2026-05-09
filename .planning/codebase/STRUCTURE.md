# Codebase Structure

_Generated: 2026-05-08 | Focus: arch_

## Summary

Standard Node.js/TypeScript monolith. Source lives entirely in `src/`. The top-level split is horizontal by technical concern (config, controllers, diamond, middleware, routes, services, types, utils). Services are further split into `core-facets/` (pure business logic) and `multi-chain/` (DLT adapters). There is no `dist/` checked in — it is the compiled output of `tsc`.

---

## Directory Layout

```
qc-backend/
├── prisma/
│   └── schema.prisma               # Single source of truth for all data models
├── src/
│   ├── server.ts                   # Express app, global middleware, startup, SchedulerService.start()
│   ├── config/
│   │   ├── env.ts                  # Environment variable parsing and validation helpers
│   │   └── prisma.ts               # Prisma client singleton
│   ├── controllers/                # Thin HTTP adapters — extract req data, call Facets, return res
│   │   ├── AgentController.ts
│   │   ├── ApiKeyController.ts
│   │   ├── AssetController.ts
│   │   ├── BlindContactController.ts
│   │   ├── ContextRouterController.ts
│   │   ├── DeviceController.ts
│   │   ├── TenantController.ts
│   │   ├── WalletController.ts
│   │   └── WebhookController.ts
│   ├── diamond/                    # Diamond Pattern routing core — the only two files you need
│   │   ├── DiamondProxy.ts         # POST /api/v1/diamond handler; builds secureContext; calls FacetRegistry
│   │   └── FacetRegistry.ts        # Selector → Facet function lookup table
│   ├── docs/
│   │   └── openapi.ts              # Scalar UI / OpenAPI spec assembly
│   ├── interfaces/
│   │   └── IDLTAdapter.ts          # Abstract contract for all blockchain adapters
│   ├── middleware/
│   │   ├── apiKeyAuth.ts           # requireApiKey / optionalApiKey — injects secureContext into req
│   │   ├── errorHandler.ts         # Global Express error + 404 handlers
│   │   ├── idempotencyGuard.ts     # requireIdempotency — UUIDv4 header, in-memory store
│   │   ├── rateLimiter.ts          # tenantRateLimiter — Postgres-backed per-plan-tier
│   │   ├── rbacGuard.ts            # requireRole / requireAdmin / requireOperator / requireReader
│   │   └── requireAgentSignature.ts # M2M Falcon-512 payload signature verification
│   ├── routes/
│   │   ├── index.ts                # Central mount point — registers all v1 routes + diamond + scan
│   │   └── v1/
│   │       ├── agentRoutes.ts      # /api/v1/agent — M2M agent management
│   │       ├── apiKeyRoutes.ts     # /api/v1/api-keys — generate, list, revoke, rotate
│   │       ├── assetRoutes.ts      # /api/v1/assets — CRUD + ownership
│   │       ├── circuitBreakerRoutes.ts # /api/v1/circuit-breaker — pause/resume DLT workers
│   │       ├── deviceRoutes.ts     # /api/v1/devices — NFC device registration
│   │       ├── docsRoutes.ts       # /api-docs — Scalar UI
│   │       ├── publicRoutes.ts     # /api/v1/public — unauthenticated asset read + document verify
│   │       ├── tenantRoutes.ts     # /api/v1/tenants — tenant CRUD + usage stats
│   │       ├── walletRoutes.ts     # /api/v1/wallet — custodial wallet deposit address + balance
│   │       └── webhookRoutes.ts    # /api/v1/webhooks/mercadopago — payment webhook inbox
│   ├── scripts/
│   │   ├── validate-phase1.ts      # One-shot smoke test for Phase 1 (tenant + api-key flows)
│   │   └── validate-phase2.ts      # One-shot smoke test for Phase 2 (asset + device flows)
│   ├── seeds/
│   │   └── seed-bootstrap.ts       # Seeds initial Tenant + API keys (npm run seed:bootstrap)
│   ├── services/
│   │   ├── AnchorQueueService.ts   # FIFO DLT anchoring — processQueue() with atomic row lock
│   │   ├── BlockchainObserverService.ts # Scans chains for incoming stablecoin deposits
│   │   ├── CircuitBreakerService.ts # Global + per-wallet pause flag management
│   │   ├── CryptoService.ts        # AES-256-GCM encryption for Device.masterKey
│   │   ├── DLTAdapterFactory.ts    # Singleton factory — getAdapter(chain) → IDLTAdapter
│   │   ├── EscrowReleaseWorker.ts  # Cron worker — releases AUTO-mode matured escrows
│   │   ├── KMSService.ts           # Key wrapping service — never stores raw key material
│   │   ├── QTagCryptoService.ts    # AES-128 SFI SDM — CMAC and picc_data ops
│   │   ├── QuantumSignerService.ts # Falcon-512 signing for QTAG commissioning
│   │   ├── RetryWorker.ts          # Exponential backoff retry for failed DLT ops; DLQ after 5 attempts
│   │   ├── SDMVerifierService.ts   # Public NFC tap validation (CMAC + anti-replay counter)
│   │   ├── SchedulerService.ts     # node-cron orchestration — triggers all background workers
│   │   ├── SecurityWatchdogService.ts # Anomaly detection; writes PanicLog on critical events
│   │   ├── WalletService.ts        # HD wallet derivation + custodial address management
│   │   ├── core-facets/            # PURE BUSINESS LOGIC — no Express, no HTTP
│   │   │   ├── AgentRegistryFacet.ts         # M2M/IoT agent register/revoke/status
│   │   │   ├── AlgorandAnchorFacet.ts        # Legacy Algorand anchor (superseded by AlgorandAdapter)
│   │   │   ├── ApiKeyManagementFacet.ts      # Key generation, validation (bcrypt), revocation, rotation
│   │   │   ├── AssetRegistryFacet.ts         # Asset CRUD + multi-ownership
│   │   │   ├── BillingFacet.ts               # MercadoPago payment confirmation → asset ACTIVE
│   │   │   ├── BlindContactLogFacet.ts       # Double-blind finder contact submission
│   │   │   ├── CommissioningFacet.ts         # QTAG NFC chip encoding: start/confirm/status
│   │   │   ├── ContextRouterFacet.ts         # Routes asset reads (private vs public context)
│   │   │   ├── DeviceGuardFacet.ts           # NFC tap validation + anti-replay counter enforcement
│   │   │   ├── DeviceRegistryFacet.ts        # NFC device registration
│   │   │   ├── DocumentVerificationFacet.ts  # Reverse lookup by SHA3-512 document hash
│   │   │   ├── EscrowFacet.ts                # Escrow lock/release/cancel/status + DLT dispatch
│   │   │   ├── EventLogFacet.ts              # Authenticated + public event creation + review
│   │   │   ├── LifecycleFacet.ts             # Asset state machine transitions + role enforcement
│   │   │   ├── NfcValidationFacet.ts         # NFC CMAC validation utility
│   │   │   ├── PublicProfileFacet.ts         # Public-safe asset data filtering (publicDataKeys)
│   │   │   ├── RateLimiterFacet.ts           # Postgres-backed per-tenant rate limit counters
│   │   │   ├── TenantManagementFacet.ts      # Tenant CRUD + activate/deactivate + usage stats
│   │   │   └── TransferRegistryFacet.ts      # Ownership transfer initiation → AWAITING_PAYMENT
│   │   └── multi-chain/
│   │       ├── AlgorandAdapter.ts            # IDLTAdapter for Algorand (primary production chain)
│   │       ├── EthAdapter.ts                 # IDLTAdapter for Ethereum
│   │       ├── PolygonAdapter.ts             # IDLTAdapter for Polygon
│   │       ├── SolanaAdapter.ts              # IDLTAdapter for Solana
│   │       ├── SorobanAdapter.ts             # IDLTAdapter for Stellar/Soroban
│   │       └── types.ts                      # Shared multi-chain types (TripleSignPayload, etc.)
│   ├── types/
│   │   ├── index.ts                # AuthenticatedRequest, ApiResponse, RBAC matrix, AuditActions
│   │   └── nfc-pcsc.d.ts           # Type stubs for nfc-pcsc native module
│   └── utils/
│       ├── PostQuantumCrypto.ts    # Falcon-512 sign/verify via falcon-crypto package
│       └── WebhookDispatcher.ts    # B2B tenant webhook fire-and-forget dispatcher
├── .env.example                    # Required env var template (never commit .env)
├── package.json
├── tsconfig.json
└── CLAUDE.md                       # Architecture law and command reference
```

---

## Key File Locations

**Entry Point:**
- `src/server.ts` — Express app bootstrap, global middleware, graceful shutdown, `SchedulerService.start()`

**Diamond Core:**
- `src/diamond/DiamondProxy.ts` — the single POST handler for all Facet calls
- `src/diamond/FacetRegistry.ts` — add new selectors here when adding new Facets

**Route Registration:**
- `src/routes/index.ts` — all route module mounts + diamond + SDM scan

**Data Model:**
- `prisma/schema.prisma` — authoritative DB schema; edit here then run `npm run db:migrate`

**Type Contracts:**
- `src/types/index.ts` — `AuthenticatedRequest`, `ApiResponse`, `RBAC_HIERARCHY`, `AuditActions`, `DiamondFacets`
- `src/interfaces/IDLTAdapter.ts` — DLT adapter contract; all chain adapters must implement this

**Shared Config:**
- `src/config/prisma.ts` — Prisma client singleton (import this everywhere, never instantiate directly)
- `src/config/env.ts` — env var helpers

---

## Naming Conventions

**Files:**
- Facets: `PascalCaseFacet.ts` (e.g., `AssetRegistryFacet.ts`)
- Controllers: `PascalCaseController.ts`
- Services: `PascalCaseService.ts`
- Middleware: `camelCase.ts` (e.g., `apiKeyAuth.ts`, `rbacGuard.ts`)
- Routes: `camelCaseRoutes.ts`
- Adapters: `PascalCaseAdapter.ts`
- Interfaces: `IPascalCase.ts`

**Selectors (FacetRegistry keys):**
- Pattern: `<domain>.<verb>` (e.g., `asset.create`, `lifecycle.transition`, `escrow.lock`)
- Domain matches Facet responsibility area, verb is a lowercase action

**Prisma models:**
- PascalCase singular (e.g., `Tenant`, `Asset`, `EventLog`, `PendingTransaction`)

---

## Module Boundaries

| Module | Can import | Cannot import |
|---|---|---|
| `core-facets/` | `config/prisma`, `types`, `utils`, `services/` (non-facet), other `core-facets/` | `controllers/`, `routes/`, `middleware/`, Express |
| `multi-chain/` | `interfaces/IDLTAdapter`, `services/KMSService`, `utils/PostQuantumCrypto` | `core-facets/`, `controllers/`, Express |
| `middleware/` | `types`, `config/prisma`, `core-facets/ApiKeyManagementFacet` | Other middleware (no chaining in imports) |
| `controllers/` | `core-facets/`, `types`, `middleware/` (via route composition only) | `routes/` |
| `diamond/` | `FacetRegistry`, `types` | Direct Prisma access |

---

## Where to Add New Code

**New Facet (business capability):**
1. Create `src/services/core-facets/NewCapabilityFacet.ts`
   - Export a class with static async methods
   - Signature: `static async method(secureContext: SecureContext, payload: PayloadType)`
   - All Prisma queries must include `where: { ..., tenantId: secureContext.tenantId }`
2. Register selectors in `src/diamond/FacetRegistry.ts`
3. If it needs a REST route: create `src/routes/v1/newCapabilityRoutes.ts` + controller + mount in `src/routes/index.ts`

**New REST-only endpoint (no Diamond dispatch needed):**
1. Create `src/controllers/NewThingController.ts` — thin adapter only
2. Create `src/routes/v1/newThingRoutes.ts` — compose middleware chain
3. Mount in `src/routes/index.ts`

**New DLT chain:**
1. Create `src/services/multi-chain/NewChainAdapter.ts` implementing `IDLTAdapter`
2. Add chain to `SupportedChain` type in `src/services/DLTAdapterFactory.ts`
3. Add `case 'NEW_CHAIN': return new NewChainAdapter()` in `DLTAdapterFactory.getAdapter`
4. Add chain to `Tenant.targetChain` docs (no schema change needed — it's a plain string)

**New DB model:**
1. Edit `prisma/schema.prisma`
2. Run `npm run db:migrate` (creates migration) or `npm run db:push` (dev only, no migration)
3. Run `npm run db:generate` (regenerates Prisma client)

**New background worker:**
1. Create `src/services/NewWorkerService.ts`
2. Register cron in `src/services/SchedulerService.ts` using the existing `isRunning` guard pattern

---

## Special Directories

**`prisma/`:**
- Contains `schema.prisma` and auto-generated `migrations/` (after `db:migrate`)
- The `migrations/` directory is committed to version control
- Never edit migration files manually

**`src/scripts/`:**
- One-shot validation scripts, not part of the server process
- Run via `npx tsx src/scripts/validate-phase1.ts`

**`src/seeds/`:**
- Bootstrap data for development/staging
- Run via `npm run seed:bootstrap`
- Not safe to run against production with existing data

**`dist/`:**
- TypeScript compiled output (generated by `npm run build`)
- Gitignored; only used for production deployments

**`.planning/`:**
- Architecture and planning documents for GSD workflow
- Not part of the runtime; safe to ignore for deployment
