---
phase: 01-core-gap-closure-production-hardening
status: partial
findings_in_scope: 15
fixed: 12
skipped: 3
iteration: 1
fixed_at: 2026-05-09T04:20:15Z
review_path: .planning/phases/01-core-gap-closure-production-hardening/01-REVIEW.md
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-05-09T04:20:15Z
**Source review:** `.planning/phases/01-core-gap-closure-production-hardening/01-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 15
- Fixed: 12
- Skipped: 3

## Fixed Issues

### CR-01: `generateInternalSignature` is a stub

**Files modified:** `src/services/CircuitBreakerService.ts`
**Applied fix:** Removed the fake base64 signature path from global pause. `pauseAllChains` now uses an explicit internal emergency pause path with audit metadata, while external `pauseChain` still requires Falcon admin signature verification. EVM pause/resume now checks transaction receipt success.

### CR-02: `BillingFacet.processWebhookInbox` TOCTOU race

**Files modified:** `src/services/core-facets/BillingFacet.ts`, `tests/billing-facet.test.ts`
**Applied fix:** Replaced separate `findMany`/`update` picking with a transaction that selects pending webhook inbox rows using `FOR UPDATE SKIP LOCKED` and marks them `PROCESSING` before processing.

### CR-03: `AnchorQueueService` retry queue stranding

**Files modified:** `src/services/AnchorQueueService.ts`, `src/services/RetryWorker.ts`
**Applied fix:** `AnchorQueueService` can recover `RETRY_QUEUED` rows, and `RetryWorker` now updates the source `EventLog.dltTxId` when an `ANCHOR` retry succeeds.

### CR-04: `KMSService.getQuantumMasterKey()` ephemeral keys and zeroization

**Files modified:** `src/services/KMSService.ts`
**Applied fix:** Runtime environments now fail fast when `QUANTUM_CERT_SECRET` is absent instead of generating an ephemeral master key. The ephemeral fallback is limited to tests. Cache clearing now zeroizes the cached `Uint8Array` in place.

### CR-05: `AlgorandAnchorFacet` signing secret fallback

**Files modified:** `src/services/core-facets/AlgorandAnchorFacet.ts`
**Applied fix:** Removed the `event.tenantId` signing-secret fallback. PQC proof generation now uses the KMS-managed quantum master key path.

### CR-06: Public contribution abuse protection

**Files modified:** `src/routes/v1/publicRoutes.ts`, `src/services/core-facets/CurationFacet.ts`, `tests/curation-facet.test.ts`
**Applied fix:** Added a route-level public contribution limiter, email/phone validation, payload size cap, and payload depth cap before storage writes.

### CR-07: Lifecycle transition atomicity

**Files modified:** `src/services/core-facets/LifecycleFacet.ts`, `tests/lifecycle-diamond.test.ts`
**Applied fix:** Wrapped asset status update and `EventLog` creation in a single Prisma transaction.

### WR-02: MercadoPago access token fallback

**Files modified:** `src/services/core-facets/BillingFacet.ts`, `src/server.ts`, `tests/billing-facet.test.ts`
**Applied fix:** Removed the `TEST-123` fallback. `BillingFacet.getClient()` now throws if `MP_ACCESS_TOKEN` is missing, and production startup validation includes `MP_ACCESS_TOKEN`.

### WR-03: Billing webhook tenant isolation

**Files modified:** `src/services/core-facets/BillingFacet.ts`, `tests/billing-facet.test.ts`
**Applied fix:** Payment preferences now embed tenant metadata, and approved payment webhook handling requires tenant context before looking up the asset with tenant scope.

### WR-04: Scheduler cron interval validation

**Files modified:** `src/services/SchedulerService.ts`, `tests/scheduler.test.ts`
**Applied fix:** Added shared interval validation for configurable scheduler intervals, enforcing integer values from 5 to 59 seconds before cron registration.

### WR-05: Unused EVM receipt variables

**Files modified:** `src/services/CircuitBreakerService.ts`
**Applied fix:** EVM pause/resume now uses the receipt by failing if no receipt is returned or if `receipt.status !== 1`.

### WR-08: Document verification negative response leak

**Files modified:** `src/services/core-facets/DocumentVerificationFacet.ts`, `src/routes/v1/publicRoutes.ts`, `tests/document-verification.test.ts`
**Applied fix:** Public negative document verification responses now return uniform `{ verified: false }` without reason strings.

## Skipped Issues

### WR-01: `QuantumSignerService.verifyTriple` seal verification

**File:** `src/services/QuantumSignerService.ts:194`
**Reason:** Skipped because true Falcon verification requires a public-key contract change; the current `TripleSignPayload` does not carry or resolve a quantum public key. Renaming the method would require coordinated adapter changes outside a safe review-fix pass.
**Original issue:** `verifyTriple` validates structure and hashes but does not cryptographically verify `quantumSeal`.

### WR-06: `AnchorQueueService` production console logging

**File:** `src/services/AnchorQueueService.ts:52`
**Reason:** Skipped because the project does not yet have a structured logger abstraction. Replacing logs properly would be a cross-cutting OPS-03 change rather than a safe local fix.
**Original issue:** Production queue processing logs internal identifiers to stdout.

### WR-07: `CurationFacet.reviewContribution` rejection metadata in payload

**File:** `src/services/core-facets/CurationFacet.ts:163`
**Reason:** Skipped because the safe fix requires a Prisma schema and migration decision for `rejectionReason` or `reviewMetadata`. The current pass avoided schema changes not already required by Critical findings.
**Original issue:** Rejection reason is stored by mutating original contribution payload JSON.

## Verification

- `npx vitest run tests/billing-facet.test.ts tests/curation-facet.test.ts tests/document-verification.test.ts tests/lifecycle-diamond.test.ts tests/scheduler.test.ts tests/anchor-queue-skip-locked.test.ts` — passed, 43 tests.
- `npm run build` — passed.

---

_Fixed: 2026-05-09T04:20:15Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
