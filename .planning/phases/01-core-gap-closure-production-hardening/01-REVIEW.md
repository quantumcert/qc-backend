---
phase: 01-core-gap-closure-production-hardening
reviewed: 2026-05-09T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - .env.example
  - prisma/schema.prisma
  - src/controllers/ContributionController.ts
  - src/controllers/TransferController.ts
  - src/diamond/FacetRegistry.ts
  - src/routes/index.ts
  - src/routes/v1/assetRoutes.ts
  - src/routes/v1/contributionRoutes.ts
  - src/routes/v1/publicRoutes.ts
  - src/server.ts
  - src/services/AnchorQueueService.ts
  - src/services/CircuitBreakerService.ts
  - src/services/KMSService.ts
  - src/services/QuantumSignerService.ts
  - src/services/SchedulerService.ts
  - src/services/core-facets/AlgorandAnchorFacet.ts
  - src/services/core-facets/BillingFacet.ts
  - src/services/core-facets/CurationFacet.ts
  - src/services/core-facets/DocumentVerificationFacet.ts
  - src/services/core-facets/LifecycleFacet.ts
  - tests/anchor-queue-skip-locked.test.ts
  - tests/chain-transaction-tenant.test.ts
  - tests/circuit-breaker-security.test.ts
  - tests/curation-facet.test.ts
  - tests/curation-routes.test.ts
  - tests/lifecycle-diamond.test.ts
  - tests/quantum-signer-verify.test.ts
  - tests/scheduler.test.ts
  - tests/transfer-diamond.test.ts
  - tests/transfer-rest.test.ts
findings:
  critical: 7
  warning: 8
  info: 4
  total: 19
status: resolved_by_review_fix
resolution_status: complete_with_non_blocking_deferred_items
resolved_by: .planning/phases/01-core-gap-closure-production-hardening/01-REVIEW-FIX.md
critical_remaining: 0
blocking_remaining: 0
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** resolved by `.planning/phases/01-core-gap-closure-production-hardening/01-REVIEW-FIX.md`

## Status de Resolução

A revisão original encontrou 19 achados. O ciclo de correção posterior resolveu todos os 7 críticos e 5 dos 8 avisos em escopo. Os 3 avisos restantes foram documentados como dívida técnica não bloqueante em `01-REVIEW-FIX.md` porque exigem mudança de contrato, logger estruturado ou decisão de schema/migration.

## Summary

This phase closed SEC-01..06 and CORE-01..06 across the Diamond Pattern backend. The architecture is sound and the core invariant (domain agnosticism, tenant isolation via secureContext) is consistently applied. However, seven critical issues were found spanning authentication bypass, data integrity loss, insecure cryptographic fallback, missing input validation, and a race condition in the billing webhook processor. Eight warnings cover logic errors, dead code, and missing error handling. Four info items document quality improvements.

---

## Critical Issues

### CR-01: `generateInternalSignature` is a stub — not a real Falcon-512 signature

**File:** `src/services/CircuitBreakerService.ts:289-295`
**Issue:** `pauseAllChains()` generates an "admin signature" by base64-encoding a JSON blob. This stub then passes `verifyAdminSignature()`, which calls `QuantumSignerService.verifySignature()`. The verification will fail (return `false`) because the base64-encoded JSON is not a valid Falcon-512 signature. The result is that `pauseAllChains()` — the **global emergency halt** invoked by `SecurityWatchdogService` — will fail to pause any EVM chain and will silently succeed for non-EVM chains via the local-state path, depending on whether `CIRCUIT_BREAKER_ADMIN_PUBKEY` is set. An anomaly detection trigger therefore cannot reliably engage the circuit breaker.

```typescript
// CURRENT — stub, not Falcon-512
private async generateInternalSignature(action: string): Promise<string> {
  const payload = { action, timestamp: Date.now(), nonce: crypto.randomUUID() };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
```

**Fix:** Either (a) sign with the real master Falcon-512 key via `QuantumSignerService.signPayloadRaw`, or (b) add a separate internal bypass path in `pauseChain` that skips signature verification when called from `pauseAllChains` and log the internal trigger instead — but document the security trade-off explicitly.

---

### CR-02: `BillingFacet.processWebhookInbox` — TOCTOU race condition allows double-processing

**File:** `src/services/core-facets/BillingFacet.ts:112-113`
**Issue:** The PROCESSING-marker update and the actual payment processing are **not atomic**. The code:
1. Fetches `PENDING` records with `findMany`
2. Marks one as `PROCESSING` with a separate `update`
3. Then calls MercadoPago and updates the asset

Between steps 1 and 2, two concurrent scheduler ticks can pick the same inbox record. The comment "prevent concurrent picks" is not enforced — a second tick running immediately after step 1 but before step 2 will also pick the same record. This can trigger double asset transitions and double MercadoPago payment queries.

```typescript
// No transaction wrapping — two scheduler ticks can pick same record
await prisma.webhookInbox.update({ where: { id: inbox.id }, data: { status: 'PROCESSING' } });
// ... payment processing happens here
```

**Fix:** Wrap the `findMany` + `update to PROCESSING` in a `$transaction` with `SELECT FOR UPDATE SKIP LOCKED` (same pattern used in `AnchorQueueService`), or use `updateMany` with a `WHERE status = 'PENDING'` filter inside the transaction before returning the rows to process.

---

### CR-03: `AnchorQueueService` — events marked `RETRY_QUEUED` are permanently stranded

**File:** `src/services/AnchorQueueService.ts:125-126`
**Issue:** When anchoring fails (non-funds error), `dltTxId` is set to `'RETRY_QUEUED'`. The SELECT FOR UPDATE query filters `dltTxId IS NULL`. Therefore events with `dltTxId = 'RETRY_QUEUED'` are **never picked up by AnchorQueueService again**. The only path back is if `RetryWorker` processes them successfully and presumably resets `dltTxId`. However, nothing in `RetryWorker.enqueue()` or the queue query resets `dltTxId` to `null` on retry success — the event stays stranded unless that code exists in `RetryWorker` (not reviewed here, but the pattern is inconsistent with the PENDING_FUNDS path, which does reset `dltTxId: null`).

**Fix:** Confirm that `RetryWorker` resets `EventLog.dltTxId` to the successful `txId` on success. If not, add a `prisma.eventLog.update` inside `RetryWorker`'s success path. Additionally, add `'RETRY_QUEUED'` to the `AnchorQueueService` SQL filter as a recovery mechanism, or always rely on RetryWorker for that path and document the contract explicitly.

---

### CR-04: `KMSService.getQuantumMasterKey()` — ephemeral key in dev makes Falcon signatures unverifiable after restart

**File:** `src/services/KMSService.ts:102-105`
**Issue:** When `QUANTUM_CERT_SECRET` is missing in dev/test, a fresh Falcon-512 key pair is generated from `falcon.keyPair()` — this is random and not reproducible. The master key is cached only in-memory. Any restart (e.g., during a test suite run with `vitest --watch`, or a dev server restart) generates a new key. Events anchored with one key can never be verified with the new key. Furthermore, the cached `masterKeyCache` is a `Uint8Array` reference; `clearMasterKeyCache()` zeroizes a copy (`Buffer.from(this.masterKeyCache)`) but not the original `Uint8Array`, so zeroization does not actually scrub the real bytes.

```typescript
// Zeroization bug: Buffer.from() copies — does not share memory with the original Uint8Array
const buf = Buffer.from(this.masterKeyCache);
buf.fill(0);
this.masterKeyCache = null; // original Uint8Array bytes are still in memory
```

**Fix:** For the zeroization bug, use `this.masterKeyCache.fill(0)` before nulling the reference. For the ephemeral key risk, require `QUANTUM_CERT_SECRET` in dev too (or at minimum warn prominently), and ensure tests that use a fixed mnemonic/secret do so via environment setup, not by relying on the fallback.

---

### CR-05: `AlgorandAnchorFacet` — PQC fallback uses `event.tenantId` as the signing secret

**File:** `src/services/core-facets/AlgorandAnchorFacet.ts:47`
**Issue:** When `QUANTUM_CERT_SECRET` is not set, the Falcon-512 signing secret falls back to `event.tenantId` — a database primary key (a CUID string). A CUID is not a cryptographic secret. This means all Falcon-512 signatures produced in this fallback are trivially forgeable by anyone who knows the tenant ID (which is included in the `ChainTransaction` metadata and logged to console).

```typescript
const tenantSecret = process.env.QUANTUM_CERT_SECRET || event.tenantId; // BLOCKER
```

**Fix:** Remove the `|| event.tenantId` fallback entirely. If `QUANTUM_CERT_SECRET` is absent, throw explicitly or use the master key from `KMSService.getQuantumMasterKey()` converted to a hex string. The signing path must never silently degrade to a non-secret.

---

### CR-06: `CurationFacet.submitContribution` — no rate limiting or abuse protection on the public endpoint

**File:** `src/routes/v1/publicRoutes.ts:74` and `src/services/core-facets/CurationFacet.ts:30-86`
**Issue:** `POST /api/v1/public/asset/:assetId/contribution` accepts any phone or email string with no validation, no rate limiting at the route level (neither `tenantRateLimiter` nor a public-specific limiter is applied), and no length cap on `payload`. An attacker can flood the `PendingContribution` table with arbitrary data at zero cost, causing storage exhaustion and degrading reviewer performance. The global IP rate limiter (200 req/min) is the only protection, which is insufficient for a write endpoint that stores unbounded `payload` JSON.

**Fix:** Add route-level rate limiting (e.g., 10 submissions per IP per 15 minutes), validate that `phone`/`email` match expected formats (regex), and enforce a maximum `payload` size/depth. Consider a CAPTCHA or proof-of-work for the public contribution path.

---

### CR-07: `LifecycleFacet.transition` — `asset.update` and `eventLog.create` are not wrapped in a transaction

**File:** `src/services/core-facets/LifecycleFacet.ts:72-92`
**Issue:** The asset status update and the EventLog creation are two separate Prisma calls with no transaction wrapper. If `eventLog.create` fails (e.g., database constraint violation, network timeout), the asset state has already been updated but there is **no audit trail** for the transition. This is a data integrity problem: the system is in a state where an asset changed status but there is no immutable event record to prove it.

```typescript
// Two separate writes — not atomic
await prisma.asset.update({ where: { id: assetId }, data: { status: targetState } });
await prisma.eventLog.create({ data: { ... } }); // if this fails, no rollback
```

**Fix:** Wrap both writes in `prisma.$transaction(async (tx) => { ... })` so they succeed or fail together.

---

## Warnings

### WR-01: `QuantumSignerService.verifyTriple` — does not perform cryptographic Falcon-512 verification of `quantumSeal`

**File:** `src/services/QuantumSignerService.ts:194-248`
**Issue:** The method comment explicitly states "Full Falcon verification requires liboqs integration. For now, we trust the seal generated by our own service." This means `verifyTriple` does **not** actually verify the `quantumSeal` Falcon-512 signature — it only checks presence (`length < 10`) and recomputes the hash of the other fields. Any caller of `verifyTriple` is under the false impression they received cryptographic verification. The `shieldedTimestamp` check (5-minute tolerance) further conflates freshness with integrity.

**Fix:** Either (a) implement real Falcon-512 verification via `PostQuantumCrypto.verifySignatureFalcon512` for the `quantumSeal` field, or (b) rename the method to `verifyTripleStructure` and document clearly that cryptographic seal verification is NOT performed, so callers make an informed choice.

---

### WR-02: `BillingFacet` — hardcoded fallback `MP_ACCESS_TOKEN = 'TEST-123'`

**File:** `src/services/core-facets/BillingFacet.ts:9`
**Issue:** `process.env.MP_ACCESS_TOKEN || 'TEST-123'` silently falls back to a test token in any environment where the variable is missing. If `MP_ACCESS_TOKEN` is not set in staging, this code will attempt to call MercadoPago with a test credential and succeed silently, potentially causing confusion in production-like environments.

**Fix:** Remove the fallback. If `MP_ACCESS_TOKEN` is absent, throw at service initialization time (similar to how `QUANTUM_CERT_SECRET` is handled). Add `MP_ACCESS_TOKEN` to the required env var check in `server.ts` for production.

---

### WR-03: `BillingFacet.processPaymentWebhook` — no tenant isolation when fetching asset by `external_reference`

**File:** `src/services/core-facets/BillingFacet.ts:64`
**Issue:** `prisma.asset.findUnique({ where: { id: assetId! } })` does not scope by `tenantId`. MercadoPago's `external_reference` is the `assetId`, which is a CUID and globally unique — but the absence of a tenant scope means that if an attacker (or a misconfigured MercadoPago account) sends a webhook with the `external_reference` of another tenant's asset, the system will change that asset's status to `ACTIVE` without any authorization check.

**Fix:** The webhook context does not have a tenant-authenticated `secureContext`. Add a check that the asset's `tenantId` matches the expected context derived from the MercadoPago account (store a mapping), or use an HMAC-verified webhook secret that embeds the `tenantId`. At minimum, log a warning if the asset is found but its tenant does not match the expected MP account.

---

### WR-04: `SchedulerService` — cron pattern validation missing for user-controlled interval

**File:** `src/services/SchedulerService.ts:17-19`
**Issue:** `parseInt(process.env.ANCHOR_QUEUE_INTERVAL_SECONDS ?? '30', 10)` is passed directly into a cron pattern string `*/${intervalSeconds} * * * * *`. If the env var is set to `0`, `NaN`, or a value > 59, `node-cron` will throw or produce invalid behavior at runtime. The same applies to `RETRY_WORKER_INTERVAL_SECONDS`, `BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS`, `ESCROW_RELEASE_INTERVAL_SECONDS`, and `WEBHOOK_INBOX_INTERVAL_SECONDS`.

**Fix:** Add bounds validation after `parseInt`: `if (isNaN(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 59) throw new Error(...)`. This is startup code, so failing fast is appropriate.

---

### WR-05: `CircuitBreakerService.pauseEVMChain` / `resumeEVMChain` — `receipt` variable is unused

**File:** `src/services/CircuitBreakerService.ts:221, 260`
**Issue:** `const receipt = await tx.wait()` is assigned but never used. The receipt contains confirmation data and the actual gas used. More critically, `tx.wait()` is awaited (good), but the receipt is then discarded — the `txHash` returned in the status is taken from `tx.hash` (pre-confirmation), not from the receipt. This means the returned `txHash` is correct, but the unused `receipt` variable is dead code and suggests an incomplete implementation.

**Fix:** Either use the receipt (e.g., log `receipt.blockNumber`, check `receipt.status === 1` for EVM success), or remove the variable assignment if the confirmation check via `tx.wait()` alone is sufficient.

---

### WR-06: `AnchorQueueService` — console.log left in production path

**File:** `src/services/AnchorQueueService.ts:52, 57, 89, 101`
**Issue:** Multiple `console.log` and `console.error` calls in the production queue processing path expose internal event IDs, tenant IDs, chain names, and DLT transaction IDs to stdout. In a containerized environment with aggregated logging, this data ends up in log storage accessible to operations staff.

**Fix:** Replace with a structured logger (e.g., `pino`, `winston`) that supports log level filtering and redaction of sensitive fields. This is also flagged as TODO(OPS-03) in other files — the pattern is consistent but it is a real risk in production.

---

### WR-07: `CurationFacet.reviewContribution` — rejection reason is embedded into `payload` JSON, not in a dedicated field

**File:** `src/services/core-facets/CurationFacet.ts:163-166`
**Issue:** When a contribution is rejected, the `reason` is stored by mutating the original `payload` JSON: `{ ...(pending.payload as ...), _rejectionReason: reason ?? null }`. This mixes review metadata into the contributor's original payload. The original payload is no longer immutable — it becomes impossible to distinguish what the contributor submitted from what the reviewer appended. This is an audit trail integrity issue.

**Fix:** Add a `rejectionReason` column to `PendingContribution` in the Prisma schema, or store reviewer annotations in a separate JSON field (e.g., `reviewMetadata`). The original `payload` must not be modified post-submission.

---

### WR-08: `DocumentVerificationFacet.verifyByHash` — leaks event existence via timing for unverified documents

**File:** `src/services/core-facets/DocumentVerificationFacet.ts:40-41`
**Issue:** When `verified = false`, the response includes `reason: 'Document not found in registry'`. A public endpoint that distinguishes "invalid hash format" from "document not found" leaks information about what hashes exist in the system. Combined with the public nature of the endpoint (no auth), an adversary can enumerate documents by probing with valid-format hashes and observing which ones return `not found` vs `verified: true`.

**Fix:** This is an acceptable design trade-off if the hash space (SHA3-512, 2^512) makes enumeration infeasible — but the reason string `'Document not found in registry'` should be consistent with `'Invalid hash format'` to avoid leaking the distinction. Consider returning a uniform `{ verified: false }` with no `reason` for all negative cases on the public endpoint, and reserve `reason` for authenticated callers.

---

## Info

### IN-01: `src/routes/index.ts:1` — malformed comment with escaped newlines

**File:** `src/routes/index.ts:1`
**Issue:** The first line contains literal `\n` escape sequences: `// Route index — Diamond Pattern API Router\n// EIP-2535 architecture: mounts v1 facets.`. These are not actual newlines; they are visible as `\n` in the source file. This is a minor editor artifact.

**Fix:** Replace the literal `\n` with an actual newline character.

---

### IN-02: `src/server.ts` — `allowedHeaders` missing `X-Idempotency-Key`

**File:** `src/server.ts:66`
**Issue:** The CORS `allowedHeaders` array includes `'Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With'` but does not include `'X-Idempotency-Key'`. Browser clients sending `PATCH /api/v1/assets/:id/transfer` (which requires `X-Idempotency-Key`) from a cross-origin frontend will have the idempotency header stripped by CORS preflight. The request will reach the server without the header, and the idempotency guard will return 400.

**Fix:** Add `'X-Idempotency-Key'` to `allowedHeaders` in the CORS configuration.

---

### IN-03: `src/services/KMSService.ts:174-176` — Algorand key derivation comment is misleading

**File:** `src/services/KMSService.ts:174-176`
**Issue:** The comment says "Return the full secret key (seed + public key) for algosdk" but the code constructs `Buffer.concat([secretKey.slice(0, 32), publicKey])`. The nacl `secretKey` field from `keyPair.fromSeed` is already 64 bytes (seed + public). Slicing to 32 and re-appending the public key reconstructs the same 64-byte value, but the comment incorrectly implies the seed is being returned rather than reconstructed. This is confusing and may mislead future maintainers into changing the slice incorrectly.

**Fix:** Update the comment to clarify: "nacl secretKey is 64 bytes (seed || pubkey). We reconstruct it explicitly as [seed_32_bytes || pubkey_32_bytes] for algosdk compatibility."

---

### IN-04: `tests/curation-facet.test.ts:36` — `$transaction` mock does not pass `tx` client correctly to the inner function

**File:** `tests/curation-facet.test.ts:36-45`
**Issue:** The `$transaction` mock passes the same top-level mock objects as the `tx` client. In production, `CurationFacet.reviewContribution` calls `tx.pendingContribution.update` and `tx.eventLog.create` inside the transaction, using the transaction client — not the top-level prisma object. If the mock `$transaction` passes the same objects, it hides bugs where code incorrectly uses `prisma.eventLog.create` instead of `tx.eventLog.create` inside a transaction block. The test passes, but would not catch that class of bug.

**Fix:** Use distinct mock objects for the `tx` client inside `$transaction` vs the top-level prisma mock, so tests can assert that transactional operations use the transaction client.

---

_Reviewed: 2026-05-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
