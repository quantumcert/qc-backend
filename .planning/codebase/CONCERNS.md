# Codebase Concerns

_Generated: 2026-05-08 | Focus: concerns_

---

## Summary

The qc-backend is architecturally sound but carries several **critical security gaps** that are masked by dev-mode fallbacks and stub implementations — most critically, Falcon-512 signature verification is not enforced in the CircuitBreaker and QuantumSignerService (any non-empty string passes as a valid admin signature), and the CommissioningFacet uses a zero-filled key in dev mode that would crash in production. A significant volume of `as any` casts (~40+ instances) bypasses Prisma's type safety. The multi-chain DLT layer works for Algorand but has architectural gaps (hardcoded `'SYSTEM'` tenantId in all cross-chain ChainTransaction logs) that corrupt per-tenant audit trails.

---

## Technical Debt

### CRITICAL: CircuitBreaker Admin Signature Verification Is a Stub

- **Issue:** `CircuitBreakerService.verifyAdminSignature()` returns `true` for any signature with length >= 10. The Falcon-512 verification line is commented out with a TODO.
- **File:** `src/services/CircuitBreakerService.ts:274-290`
- **Impact:** Any caller that can reach the circuit breaker routes with a 10+ char string can pause all chains. This is a security-critical path.
- **Fix approach:** Implement `this.quantumSigner.verifySignature()` against `process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY`. The method exists in `QuantumSignerService` but always returns `true` — it needs `liboqs` or `oqs-node` integration.

### CRITICAL: Falcon-512 Verification Always Returns `true` in QuantumSignerService

- **Issue:** `QuantumSignerService.verifySignature()` always returns `true` regardless of input. The note says "In production, integrate with oqs-node or liboqs bindings."
- **File:** `src/services/QuantumSignerService.ts:108-117`
- **Impact:** The triple-signature escrow protocol (`verifyTriple`) checks structural presence and hash consistency, but step 5 (actual Falcon cryptographic verification of the quantum seal) is explicitly skipped.
- **Fix approach:** Integrate `oqs-node` or `liboqs` Node.js bindings. `PostQuantumCrypto.verifySignatureFalcon512()` in `src/utils/PostQuantumCrypto.ts` is actually implemented correctly via `falcon.verifyDetached` — QuantumSignerService should delegate to it.

### HIGH: CommissioningFacet Uses Zero-Filled Key in Dev, Crashes in Production

- **Issue:** `CommissioningFacet.start()` uses `Buffer.alloc(64, 0).toString('hex')` as the tenant signing key. The code throws `Error: [CommissioningFacet] tenantSecretHex must be configured via KMS in production` in production but has no real KMS path yet.
- **File:** `src/services/core-facets/CommissioningFacet.ts:47-52`
- **Impact:** QTag commissioning is non-functional in production until the KMS tenant-scoped key feature is implemented. Zero-filled signing key in dev means Falcon signatures are generated from a predictable key.
- **Fix approach:** Implement `KMSService.getTenantSecret(tenantId)` which derives a stable per-tenant Falcon key from the master secret via HKDF. The scaffolding in `KMSService` is present.

### HIGH: ChainTransaction Logs Use Hardcoded `tenantId: 'SYSTEM'` Across All Adapters

- **Issue:** Every adapter (`AlgorandAdapter`, `SolanaAdapter`, `SorobanAdapter`, `PolygonAdapter`, `EthAdapter`) logs `ChainTransaction` records with `tenantId: 'SYSTEM'` — a literal string, not a real tenant ID.
- **Files:** `src/services/multi-chain/AlgorandAdapter.ts:101`, `src/services/multi-chain/SolanaAdapter.ts:181`, `src/services/multi-chain/SorobanAdapter.ts:120`, `src/services/multi-chain/PolygonAdapter.ts:90`, `src/services/multi-chain/EthAdapter.ts:90` (and many more lines in each)
- **Impact:** All cross-chain audit logs are uncorrelated to tenants. Per-tenant transaction history (`WalletService.getBalance()` aggregates `ChainTransaction`) will silently return incorrect data for tenants. Tenant isolation violated in audit trail.
- **Fix approach:** Adapters need to accept `tenantId` as a parameter or as part of the operation context. `IDLTAdapter` interface should be extended to pass context.

### HIGH: `dltTxId` Field Used as Both TX Hash and Sentinel Values

- **Issue:** `EventLog.dltTxId` is used for four distinct purposes: (1) actual on-chain TX ID, (2) `'PROCESSING'` sentinel to implement row locking, (3) `'RETRY_QUEUED'` to signal retry state, and (4) `null` for unprocessed. This is a type-unsafe enum disguised as a nullable string.
- **File:** `src/services/AnchorQueueService.ts:35,94,112`
- **Impact:** Any query filtering on `dltTxId` must know about these sentinel values. `DocumentVerificationFacet` uses `dltTxId` as an explorer URL fragment — if an event is in `'PROCESSING'` state, the explorer URL construction will break silently.
- **Fix approach:** Add an `anchorStatus` enum column to `EventLog` (e.g., `PENDING | LOCKING | ANCHORED | RETRY_QUEUED | FAILED_FUNDS`). Keep `dltTxId` for real TX hashes only.

### HIGH: Widespread `as any` Bypasses Prisma Type Safety (~40+ instances)

- **Issue:** Prisma queries in `SecurityWatchdogService`, `WalletService`, `SDMVerifierService`, `EscrowReleaseWorker`, and `CommissioningFacet` use `(prisma as any).modelName.method()`, bypassing full Prisma type inference.
- **Files:** `src/services/SecurityWatchdogService.ts:76,125,205`, `src/services/WalletService.ts:41,50,73,98,128,143,150,189`, `src/services/SDMVerifierService.ts:54,116,117,128,142`, `src/services/EscrowReleaseWorker.ts:32`, `src/services/core-facets/CommissioningFacet.ts:71`
- **Impact:** Schema renames or field removals will cause silent runtime failures, not compile errors. The root cause appears to be stale Prisma client generation after schema changes.
- **Fix approach:** Run `npm run db:generate` to regenerate the Prisma client. If the models still require `as any`, the issue is a Prisma middleware type mismatch in `src/config/prisma.ts` — the middleware intercepts JSON fields and loses the inferred result type.

### MEDIUM: `algoexplorer.io` Explorer URL Is Dead (Service Shut Down 2023)

- **Issue:** `DocumentVerificationFacet.buildExplorerUrl()` returns `https://algoexplorer.io/tx/${dltTxId}` for Algorand transactions. AlgoExplorer shut down in 2023.
- **File:** `src/services/core-facets/DocumentVerificationFacet.ts:51`
- **Impact:** Public document verification panel shows a broken explorer link for all Algorand-anchored events. This affects the public-facing transparency feature.
- **Fix approach:** Replace with `https://explorer.perawallet.app/tx/${dltTxId}` or `https://algoexplorer.io` → `https://allo.info/tx/${dltTxId}`.

### MEDIUM: Env Config Module (`src/config/env.ts`) Is Partially Bypassed

- **Issue:** The Zod-validated `env` module exists but is bypassed in ~30+ locations. Services like `SchedulerService`, `BlockchainObserverService`, `SecurityWatchdogService`, `KMSService`, and chain adapters read `process.env` directly.
- **Files:** `src/services/SchedulerService.ts:16,68,132`, `src/services/SecurityWatchdogService.ts:58-61`, `src/services/multi-chain/SorobanAdapter.ts:46-49`, `src/services/BlockchainObserverService.ts:300,364,456-463`
- **Impact:** Variables like `SOLANA_ANCHOR_PROGRAM_ID`, `STELLAR_SOROBAN_RPC_URL`, `STELLAR_ANCHOR_CONTRACT_ID`, `POLYGON_TRANSFER_FACET_ADDRESS`, and all watchdog thresholds are not validated at startup — missing vars produce silent failures at runtime rather than startup crash.
- **Fix approach:** Add all required chain env vars to the `envSchema` in `src/config/env.ts`. Make imports reference the validated `env` object.

### MEDIUM: EVM Key Derivation Is Not Standard HD (BIP-32/BIP-44)

- **Issue:** `KMSService.derivePrivateKey()` for EVM chains uses `ethers.keccak256(masterPrivateKey + accountIndex)` — a bespoke scheme. For Algorand it uses NaCl seed derivation from a Keccak hash. Neither follows BIP-44.
- **File:** `src/services/KMSService.ts:160-200`
- **Impact:** Derived wallets cannot be recovered from a standard seed phrase in any external wallet (Metamask, Ledger, etc.). Custody is fully platform-locked. If the master key is lost, all derived wallets are unrecoverable.
- **Fix approach:** Migrate to BIP-44 derivation (`m/44'/60'/0'/0/{index}` for EVM, `m/44'/283'/0'/0/{index}` for Algorand) using `ethers.HDNodeWallet`. Document the migration path clearly.

### MEDIUM: `KMSService` Falls Back to Ephemeral Key if `QUANTUM_CERT_SECRET` Missing

- **Issue:** If `QUANTUM_CERT_SECRET` is not set or is < 64 chars, `KMSService.getQuantumMasterKey()` generates a fresh random Falcon-512 keypair each cold start. The key is cached in memory only and lost on restart.
- **File:** `src/services/KMSService.ts:88-98`
- **Impact:** On any server restart (deploy, crash, OOM), all user wallets wrapped with the ephemeral key become unrecoverable. In production this is catastrophic. No startup crash or alerting is triggered.
- **Fix approach:** Add `QUANTUM_CERT_SECRET` to the required (not optional) fields in `src/config/env.ts`. The `envSchema` currently marks it as `z.string().optional()`.

### LOW: In-Memory IP Rate Limit Map Has No Size Cap

- **Issue:** `ipRateLimitMap` in `src/server.ts:86` grows unbounded under sustained traffic from unique IPs. Stale entries are cleaned up lazily on each request but only by iterating the full map.
- **File:** `src/server.ts:86-120`
- **Impact:** Under DDoS from many unique IPs, the map can exhaust heap memory before entries are cleaned up. The cleanup iterates the full map on every request, adding O(n) overhead.
- **Fix approach:** Cap map size (e.g., 50k entries) with LRU eviction, or replace with `express-rate-limit` (already a dependency) configured for IP-level limiting.

### LOW: `localKeyCache` in `PostQuantumCrypto` Leaks Falcon Private Keys in Memory

- **Issue:** A module-level `Map<string, Uint8Array>` in `PostQuantumCrypto.ts` caches Falcon private keys indefinitely, keyed by tenant secret hex.
- **File:** `src/utils/PostQuantumCrypto.ts:4`
- **Impact:** In a long-running server process with many tenants, all private keys ever used remain in heap memory. If Node.js heap is dumped (OOM, memory profiling), all keys are exposed.
- **Fix approach:** Replace with a bounded LRU cache (e.g., max 100 entries) and call `zeroize()` on evicted entries. Alternatively, accept the slight WASM overhead and generate keypairs without caching in production.

---

## Missing Implementations

### Sinarca Integration (SecurityWatchdogService)

- **Status:** Entirely commented out. Both the call site (`checkAnomalies`, line 143) and the stub method (`checkSinarcaAnomaly`, line 226) are placeholders with `// TODO` markers.
- **File:** `src/services/SecurityWatchdogService.ts:143-152,226-230`
- **Impact:** The `SINARCA_ALERT` anomaly type exists in the enum but is never triggered. Forest-activity panic halts are inoperative.

### Solana/Stellar Key Derivation in KMSService

- **Status:** `// TODO: Implement Solana/Stellar derivation when needed` at the end of the switch in `derivePrivateKey()`.
- **File:** `src/services/KMSService.ts:309`
- **Impact:** `deriveAndWrapPrivateKey()` for SOLANA and STELLAR chains will throw. WalletService HD key generation for those chains is blocked.

### TEAL Escrow for Algorand

- **Status:** Comment at top of `AlgorandAdapter.ts` notes "Escrow (TEAL placeholders)". The `createEscrow`, `releaseEscrow`, `cancelEscrow` methods exist but use off-chain simulation (payment to self + database record) rather than on-chain TEAL smart contracts.
- **File:** `src/services/multi-chain/AlgorandAdapter.ts:5`
- **Impact:** Algorand escrow is not cryptographically enforced on-chain. Time-lock guarantees only exist in the application database, not on the blockchain.

### Polygon Contract Address Not Validated at Startup

- **Status:** `POLYGON_TRANSFER_FACET_ADDRESS` is read in `PolygonAdapter` constructor. If not set, a `console.warn` is emitted and `facetContract = null`. Subsequent calls to escrow/transfer methods will throw a null dereference.
- **File:** `src/services/multi-chain/PolygonAdapter.ts:51-60`
- **Impact:** All Polygon escrow and transfer operations fail at runtime with an unclear error rather than failing at startup.

### MercadoPago Webhook Signature Verification

- **Status:** `WebhookController` reads `MP_WEBHOOK_SECRET` directly from `process.env` but `process.env.MP_WEBHOOK_SECRET` is not in `env.ts` schema. The MercadoPago `mercadopago` package is installed but no signature HMAC verification is visible.
- **File:** `src/controllers/WebhookController.ts:17`
- **Impact:** Webhook endpoint may accept forged payment events if secret is not validated correctly.

### Document Verification: `chain` Field Missing from EventLog Query Result

- **Status:** `DocumentVerificationFacet.verifyByHash()` casts `(event as any).chain` to build the explorer URL, but the Prisma `select` for that query does not include a `chain` field (which doesn't exist on `EventLog` in the schema).
- **File:** `src/services/core-facets/DocumentVerificationFacet.ts:107`
- **Impact:** `dltExplorerUrl` is always `null` for all verified documents, even when a DLT TX exists. The chain must be resolved from the tenant's `targetChain` field via a join.

---

## Security Concerns

### Circuit Breaker Authorization Bypass

- **Risk:** Any string >= 10 chars is accepted as a valid admin Falcon-512 signature to pause all chains globally.
- **Files:** `src/services/CircuitBreakerService.ts:274-290`, `src/routes/v1/circuitBreakerRoutes.ts:76,119`
- **Current mitigation:** Route requires an authenticated API key with ADMIN role. However, any ADMIN key holder can trigger a global pause without possessing the actual Falcon-512 admin private key.
- **Recommendation:** Implement real Falcon-512 verification before any production deployment that exposes the circuit breaker endpoint.

### Ephemeral Master Key Loss in Production

- **Risk:** If `QUANTUM_CERT_SECRET` is misconfigured in production, `KMSService` silently generates a new random master key on each restart. All wrapped user wallet private keys become permanently unrecoverable.
- **File:** `src/services/KMSService.ts:88-98`
- **Current mitigation:** A `console.warn` is logged. No crash, no alert.
- **Recommendation:** Make `QUANTUM_CERT_SECRET` a required env var; add a startup health check that verifies the master key can unwrap a known test ciphertext.

### Idempotency Key Namespace Collision

- **Risk:** `requireIdempotency` in `src/middleware/idempotencyGuard.ts:38` falls back to `tenantId: 'anonymous'` when `tenantId` is missing from the request. This could allow cross-tenant replay of idempotency keys on public routes.
- **File:** `src/middleware/idempotencyGuard.ts:38`
- **Current mitigation:** Idempotency is scoped by `${tenantId}:${idempotencyKey}`, so anonymous fallback only affects unauthenticated routes.
- **Recommendation:** Reject requests with missing `tenantId` on any mutation route rather than silently using `'anonymous'`.

### Webhook Secret Key Stored Plaintext in Database

- **Risk:** `TenantWebhook.secretKey` is stored as plaintext in the database per the Prisma schema. If the database is compromised, all outgoing webhook secrets are exposed, allowing an attacker to forge webhook events accepted by tenants.
- **File:** `prisma/schema.prisma:869`
- **Current mitigation:** None.
- **Recommendation:** Encrypt `secretKey` at rest using the same AES-256-GCM wrapping already implemented in `PostQuantumCrypto.wrapKey()`.

### Agent Selector Allowlist Bypasses When `allowedSelectors` Is Empty

- **Risk:** If an agent is created with an empty `allowedSelectors` array, the check `agent.allowedSelectors.includes(selector)` at line 54 will always return `false`, correctly blocking execution. However if an agent's `allowedSelectors` contains `'*'` as a wildcard, it will fail the includes check for any real selector. This is not a current exploit but the model has no explicit "allow all" guard.
- **File:** `src/middleware/requireAgentSignature.ts:54`
- **Current mitigation:** The includes check is correct for exact matches. No wildcard path exists today.
- **Recommendation:** Document that wildcard values are not supported; add a validation in `AgentRegistryFacet` to reject `'*'` in `allowedSelectors`.

---

## Performance Risks

### Unbounded `deposit.findMany` in WalletService Balance Calculation

- **Issue:** `WalletService.getBalance()` fetches all CONFIRMED deposits for a tenant with no `take` limit, then does the same for all `ChainTransaction` SEND records. For tenants with high deposit volume, this loads unbounded rows into memory.
- **File:** `src/services/WalletService.ts:128,150`
- **Impact:** High memory and latency for tenants with >10k deposits. The result is used to compute balance by summing in-process with `BigInt` reduction.
- **Fix approach:** Use `prisma.deposit.aggregate({ _sum: { amount: true } })` with database-level aggregation instead of fetching all rows.

### Unbounded `deposit.findMany` in BlockchainObserverService Confirmation Check

- **Issue:** `BlockchainObserverService.checkConfirmations()` fetches all PENDING deposits across all tenants with no limit.
- **File:** `src/services/BlockchainObserverService.ts:136`
- **Impact:** As the deposit table grows, every confirmation-check cycle (every 30s) scans an unbounded result set.
- **Fix approach:** Add `take: 100` (or configurable batch size) and process in pages.

### SecurityWatchdogService Fetches All Recent Deposits for Volume Spike Check Without Index on `detectedAt`

- **Issue:** The volume spike check fetches all deposits in the last minute: `deposit.findMany({ where: { detectedAt: { gte: oneMinuteAgo } } })`. The `detectedAt` field does have an index (`@@index([detectedAt])` in schema). However the `amount` field is a `String` type — summing it requires fetching all rows and reducing in JavaScript.
- **File:** `src/services/SecurityWatchdogService.ts:76-96`
- **Impact:** High memory allocation for each watchdog cycle if deposit volume is large. String-to-BigInt conversion can also throw silently (try/catch absorbs errors, inflating or deflating volume calculations).
- **Fix approach:** Store `amount` as `Decimal` or add a numeric shadow column for aggregation. Use database-level `SUM`.

### `WalletService.getQuantumAccount` Fetches All Deposits via Include

- **Issue:** `getQuantumAccount` uses `include: { deposits: { where: { status: 'CONFIRMED' } } }` — fetches all confirmed deposits for all wallets of a tenant in a single query.
- **File:** `src/services/WalletService.ts:189-197`
- **Impact:** For tenants with many wallets and many deposits, this is an O(wallets × deposits) memory load.
- **Fix approach:** Replace with aggregated balance query; return summary figures rather than raw deposit arrays.

### No Structured Logging — 205 `console.*` Calls

- **Issue:** All logging uses `console.log/warn/error` (205 occurrences). No log levels, no structured JSON output, no correlation IDs, no request tracing.
- **Impact:** Production log aggregation (Datadog, CloudWatch, Loki) cannot filter by severity, tenant, or request ID. Debugging multi-tenant issues requires grep over unstructured text.
- **Fix approach:** Introduce `pino` or `winston`. Replace `console.*` calls with a scoped logger that injects `tenantId`, `requestId`, and `service` fields.

---

## Gaps / Unknowns

- **Test coverage is unmeasured.** No coverage configuration exists in `vitest.config.ts` — there is no `coverage` block, no threshold, and no `@vitest/coverage-v8` or `@vitest/coverage-istanbul` dependency. The 3,628-line test suite exists but may have significant gaps in adapter, KMS, and escrow paths.

- **`EncodingSession` model has no tenantId FK declared in schema.** The `EncodingSession` model (line 905) has a `tenantId String` column but no `@relation` to `Tenant`. Cross-tenant isolation for QTAG commissioning sessions is not enforced at the database level.
  - **File:** `prisma/schema.prisma:905-922`

- **`AuditLog` model has no tenant FK.** `AuditLog.tenantId` is `String?` with no `@relation` — purely a string column. This means audit logs cannot be cascade-deleted on tenant deletion and cannot be queried via Prisma relational queries.
  - **File:** `prisma/schema.prisma:156-175`

- **`BlockchainObserverService.lastScannedBlock` is in-memory only.** The last scanned EVM block number is stored in a `Map` instance variable. On restart, the observer starts from `currentBlock - 100`. If the server is down for longer than ~100 blocks (~3 min on Polygon), deposits during that window will be missed permanently.
  - **File:** `src/services/BlockchainObserverService.ts:57,199`
  - **Fix approach:** Persist `lastScannedBlock` per chain in a dedicated DB table or in `Tenant`/system config.

- **No rate limiting on public document verification endpoint.** The `GET /api/v1/verify/document/:hash` route uses no per-IP or global rate limit beyond the global 200 req/min IP limiter. This endpoint performs two sequential Prisma queries — it could be used as an oracle to enumerate existing document hashes.

- **`DOCS_DEFAULT_API_KEY` env var is exposed in `docsRoutes.ts`.** The Scalar UI is pre-loaded with a default API key from `process.env.DOCS_DEFAULT_API_KEY`. If this var is set in production, the docs page effectively exposes a working API key in the browser.
  - **File:** `src/routes/v1/docsRoutes.ts:37`

---

*Concerns audit: 2026-05-08*
