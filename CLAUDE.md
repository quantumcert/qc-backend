# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # tsx watch — hot reload
npm run build        # tsc compile to dist/
npm start            # run compiled dist/server.js

# Database
npm run db:push      # push schema changes without migration (dev only)
npm run db:migrate   # create and apply migration
npm run db:generate  # regenerate Prisma client after schema changes
npm run db:studio    # open Prisma Studio UI
npm run db:reset     # destructive reset (dev only)

# Seeding
npm run seed:bootstrap  # seed initial tenant + api keys

# Testing
npm test             # vitest (unit)
npm run test:e2e     # vitest e2e suite
```

**Required env vars** (app crashes at startup without these):
- `DATABASE_URL` — PostgreSQL connection string
- `ALGOD_SERVER` — Algorand node URL
- `ALGORAND_MASTER_MNEMONIC` — Omnibus wallet mnemonic

Copy `.env.example` to `.env` to get started.

## Architecture: EIP-2535 Diamond Pattern (Node.js adaptation)

The backend is a **Node.js adaptation of the EIP-2535 Diamond Standard**. Instead of Solidity selectors, the `DiamondProxy` routes `POST /api/v1/diamond` calls by string selector to registered Facet functions. Each Facet is a pure service class with no Express dependencies — it receives a `secureContext` first and a `payload` second.

**Core invariant (Golden Rule):** All Facets must be 100% agnostic. No domain-specific terms (no "jewelry", "luxury", "luxury goods"). Only universal terms: `Tenant`, `Asset`, `Device`, `Event`, `Owner`, `Metadata`. The `payload` field in `EventLog` and `Asset.metadata` are opaque JSON blobs — the core never interprets them, only hash-validates via SHA3-512.

### Request Flow

```
HTTP Request
  → Global IP rate limiter (server.ts, in-memory Map)
  → requireApiKey middleware (validates X-API-Key header, injects tenantId/role into req)
  → tenantRateLimiter (RateLimiterFacet, Postgres-backed, per plan tier)
  → rbacGuard (requireAdmin / requireOperator / requireReader)
  → requireIdempotency (prevents double-processing on mutations)
  → Route handler / DiamondProxy
  → Facet (receives secureContext, payload)
  → Prisma → PostgreSQL
```

### Routing Strategy (Option C — Hybrid)

- **Tenant-authenticated operations** → `POST /api/v1/diamond` with `{ selector, payload }`. Selector maps to `FacetRegistry`.
- **Semantic REST state changes** → dedicated routes (e.g. `PATCH /api/v1/assets/:id/lifecycle`).
- **External webhook integrations** → dedicated routes with no `apiKeyAuth`, own signature validation (e.g. `POST /api/v1/webhooks/mercadopago`).

### Key Files

| File | Purpose |
|---|---|
| `src/diamond/FacetRegistry.ts` | Maps selector strings to Facet functions. Add new selectors here when adding Facets. |
| `src/diamond/DiamondProxy.ts` | `POST /api/v1/diamond` handler. Injects `secureContext` from middleware — never from user payload. |
| `src/routes/index.ts` | Central route mount point. All versioned routes registered here. |
| `src/interfaces/IDLTAdapter.ts` | Abstract interface for all blockchain adapters. `anchorEvent(eventId, hash): Promise<string>` and `verifyAnchor(txId): Promise<boolean>`. |
| `src/services/AnchorQueueService.ts` | Processes pending `EventLog` records without `dltTxId`. FIFO, atomic row lock (`dltTxId: 'PROCESSING'`), batch of 10. Needs a scheduler trigger to run. |
| `src/utils/PostQuantumCrypto.ts` | Falcon-512 signing via `falcon-crypto` package. Used inside `AlgorandAnchorFacet` to embed PQC signature in the Algorand note field. |
| `src/services/core-facets/AlgorandAnchorFacet.ts` | `IDLTAdapter` implementation for Algorand. Zero-value txn with note field: `QC| + tenantSHA256 + eventSHA3 + Falcon512Sig`. |

### Tenant Isolation

Every Facet method receives `secureContext` containing `{ tenantId, apiKeyId, role }` injected by `requireApiKey` middleware. **Never trust tenant context from the request body.** Prisma queries always scope by `tenantId` — cross-tenant data access is impossible at the query level.

### DLT Layer

The `IDLTAdapter` interface is the only contract between the core and blockchains. `AlgorandAnchorFacet` is the current concrete implementation. New chains (Solana, Stellar, Polygon, Ethereum) are added as new adapter classes — zero changes to `AnchorQueueService` or any Facet.

**Omnibus method:** When no Web3 wallet is connected, the Quantum Cert master wallet (`ALGORAND_MASTER_MNEMONIC`) assumes custody and pays fees. `AnchorQueueService` is the trigger — it picks up `EventLog` records with `dltTxId: null` and routes to the adapter.

### Asset Lifecycle States

```
DRAFT → ACTIVE → SUSPENDED → ARCHIVED
         ↑            |
         └────────────┘
ACTIVE → BURNED  (terminal)
ACTIVE → AWAITING_PAYMENT  (set by TransferRegistryFacet)
AWAITING_PAYMENT → ACTIVE  (set by BillingFacet on payment confirmation)
```

State transitions are enforced by `LifecycleFacet`. The `EventLog` records every transition.

### Authentication

API keys use prefix `qc_` and are passed via `X-API-Key` header (or `Authorization: Bearer qc_...`). Keys are stored as bcrypt hashes — the raw key is only shown once at creation. Roles: `ADMIN > OPERATOR > READER`.

### Idempotency

Mutations (POST, PATCH on state-changing routes) require an `X-Idempotency-Key` header, enforced by `requireIdempotency` middleware. This prevents double-charges and duplicate asset creation.

## Planned Sub-systems (not yet implemented)

1. **Core Gap Closure** — spec at `docs/superpowers/specs/2026-04-09-core-gap-closure-design.md`: `LifecycleFacet`, `TransferRegistryFacet` REST route, MercadoPago webhook, `SchedulerService` (node-cron trigger for `AnchorQueueService`)
2. **Document Verification (ZK)** — `GET /api/v1/verify/document/{sha3-512-hash}`, reverse lookup by `signatureHash`, public endpoint (no auth)
3. **Pluggable DLT Workers** — additional adapters per chain, tenant `targetChain` config, Omnibus routing
4. **M2M / Agent Registry** — `AgentRegistryFacet`, `POST /api/v1/agent/event`, Falcon-512 payload signature validation for IoT devices
5. **EscrowFacet + Time-Lock Oracle** — `LOCKED_IN_ESCROW` state, `unlockTimestamp`, `EscrowReleaseWorker` cron, multi-sig with Quantum Authority
