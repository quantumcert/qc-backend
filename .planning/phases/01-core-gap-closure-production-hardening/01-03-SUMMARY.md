---
phase: 01-core-gap-closure-production-hardening
plan: "03"
subsystem: core-gap-closure
tags:
  - REST
  - transfer
  - lifecycle
  - scheduler
  - webhook
  - billing
  - CORE-01
  - CORE-02
  - CORE-03
  - CORE-04

dependency_graph:
  requires:
    - 01-01 (REQUIRED_ENV_VARS production gate, including MP_WEBHOOK_SECRET)
    - 01-02 (DocumentVerificationFacet, AnchorQueue, ChainTransaction)
  provides:
    - PATCH /api/v1/assets/:assetId/transfer (REST wrapper for TransferRegistryFacet)
    - BillingFacet.processWebhookInbox() (WebhookInbox batch processor)
    - SchedulerService WebhookInbox cron job
    - LifecycleFacet regression test suite (terminal state enforcement)
  affects:
    - src/routes/v1/assetRoutes.ts
    - src/services/SchedulerService.ts
    - src/services/core-facets/BillingFacet.ts
    - tests/scheduler.test.ts
    - tests/lifecycle-diamond.test.ts
    - tests/transfer-diamond.test.ts

tech_stack:
  added: []
  patterns:
    - "TDD (RED/GREEN/REFACTOR) for Task 1 (transfer REST) and Task 2 (lifecycle regression)"
    - "Slim REST controller pattern (mirrors BlindContactController)"
    - "isRunning guard cron pattern extended to WebhookInbox job"
    - "Inbox pattern (persist-first, process-async via batch cron)"

key_files:
  created:
    - path: src/controllers/TransferController.ts
      purpose: "Slim REST controller wrapping TransferRegistryFacet.initiateTransfer; secureContext always from middleware"
    - path: tests/transfer-rest.test.ts
      purpose: "5 REST behavior tests for PATCH /assets/:assetId/transfer"
  modified:
    - path: src/routes/v1/assetRoutes.ts
      change: "Added PATCH /:assetId/transfer with requireApiKey+requireIdempotency+tenantRateLimiter+requireOperator chain"
    - path: src/services/core-facets/LifecycleFacet.ts
      change: "Added architectural comment to TRANSITION_RULES clarifying terminal states and BillingFacet ownership"
    - path: src/services/core-facets/BillingFacet.ts
      change: "Added processWebhookInbox() static method — batch processes PENDING→PROCESSING→DONE/FAILED"
    - path: src/services/SchedulerService.ts
      change: "Added BillingFacet import + WebhookInbox cron job with isRunning guard and WEBHOOK_INBOX_INTERVAL_SECONDS"
    - path: tests/lifecycle-diamond.test.ts
      change: "Added 6 regression tests for terminal states and invalid transitions"
    - path: tests/scheduler.test.ts
      change: "Added mocks for BillingFacet/RetryWorker/BlockchainObserver/SecurityWatchdog/EscrowRelease; added WebhookInbox registration tests"
    - path: tests/transfer-diamond.test.ts
      change: "Rule 1 fix: stale 404 assertion updated — route now exists, returns 400 on missing idempotency key"

decisions:
  - "TransferController maps request body fields buyerDocument+documentType (not toOwner+reason as described in plan) — matches actual TransferRegistryFacet.initiateTransfer signature"
  - "WebhookInbox uses status values PENDING/PROCESSING/DONE/FAILED from schema (not APPROVED/PROCESSED as in plan narrative)"
  - "processWebhookInbox delegates to existing BillingFacet.processPaymentWebhook for MercadoPago API call — avoids code duplication"

metrics:
  duration: "~5 minutes"
  completed: "2026-05-09"
  tasks_completed: 3
  files_modified: 8
  tests_added: 18
  commits: 4
---

# Phase 1 Plan 03: Core Gap Closure Summary

**One-liner:** REST transfer route + LifecycleFacet regression suite + WebhookInbox batch processor wired to SchedulerService cron.

## Tasks Completed

### Task 1: PATCH /api/v1/assets/:assetId/transfer (CORE-02) — TDD

**RED commit:** `de9b2c2` — 5 failing tests (route did not exist)
**GREEN commit:** `ba6340a` — TransferController + route registered, 5/5 passing

Created `src/controllers/TransferController.ts` as a slim REST wrapper:
- `secureContext` always sourced from middleware-injected `req.tenantId/apiKeyId/apiKeyRole` (T-03-01 mitigation)
- Error codes mapped to HTTP: ASSET_NOT_FOUND→404, INSUFFICIENT_PERMISSIONS→403, INVALID_ASSET_STATE→422
- Route chain: `requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator`

**Rule 1 fix (auto):** `tests/transfer-diamond.test.ts` had a stale assertion expecting 404 for this route. Updated to expect 400 (idempotency guard fires on missing header — proves route is reachable).

**Payload note:** `TransferRegistryFacet.initiateTransfer` accepts `{ assetId, buyerDocument, documentType }`, not `{ toOwner, reason }` as described in the plan narrative. The controller was adapted to the real Facet signature.

### Task 2: LifecycleFacet Regression Tests (CORE-01) — TDD

**Commit:** `4c73c91` — 6 regression tests + architectural comment

Tests added to `tests/lifecycle-diamond.test.ts`:
1. BURNED → ACTIVE → STATE_TRANSITION_FORBIDDEN/400
2. ARCHIVED → ACTIVE → STATE_TRANSITION_FORBIDDEN/400
3. ACTIVE → ACTIVE (no-op) → STATE_TRANSITION_FORBIDDEN/400
4. AWAITING_PAYMENT → ACTIVE → STATE_TRANSITION_FORBIDDEN/400 (BillingFacet owns this)
5. DRAFT → BURNED → STATE_TRANSITION_FORBIDDEN/400
6. DRAFT → ACTIVE with OPERATOR → 200 (positive test)

All 6 tests passed immediately — `TRANSITION_RULES` was already correct (ARCHIVED and BURNED absent = terminal; AWAITING_PAYMENT absent = BillingFacet controlled). Architectural comment added to the source.

### Task 3: SchedulerService + WebhookInbox Processor (CORE-03, CORE-04)

**Commit:** `adcd50f`

**SchedulerService** already had AnchorQueue running from `server.ts`. Added:
- `BillingFacet.processWebhookInbox()`: batch of 10 PENDING records → PROCESSING → DONE/FAILED with `prisma.webhookInbox.update`. Delegates to existing `processPaymentWebhook` for MercadoPago API call.
- New cron job in SchedulerService with `isRunning` guard, `WEBHOOK_INBOX_INTERVAL_SECONDS` env var (default 30s)

**Active cron jobs after this plan:**
| Job | Default Interval | isRunning Guard |
|-----|-----------------|-----------------|
| AnchorQueueService | 30s | yes |
| RetryWorker | 15s | yes |
| BlockchainObserverService | 30s | yes |
| SecurityWatchdogService | 60s | yes |
| EscrowReleaseWorker | 60s | yes |
| BillingFacet.processWebhookInbox | 30s | yes |

**WebhookInbox processor state:** Fully implemented — queries `status: 'PENDING'` ordered by `receivedAt`, marks PROCESSING to prevent concurrent picks, calls `processPaymentWebhook`, updates to `DONE`/`FAILED` with `lastError` and `retryCount` increment on failure.

**server.ts verification:** `SchedulerService.start()` is called inside `app.listen()` callback. `MP_WEBHOOK_SECRET` is in `REQUIRED_ENV_VARS` when `NODE_ENV=production`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale assertion in transfer-diamond.test.ts**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test "rota REST antiga PATCH /api/v1/assets/:id/transfer não existe mais" asserted status 404, but after creating the route it returns 400 (idempotency guard)
- **Fix:** Updated assertion to expect 400 and renamed test to reflect new reality
- **Files modified:** tests/transfer-diamond.test.ts
- **Commit:** ba6340a

### Schema/Payload Adaptations

**TransferController payload mapping:** Plan narrative mentioned `{ toOwner, reason }` but the actual `TransferRegistryFacet.initiateTransfer` signature uses `{ assetId, buyerDocument, documentType }`. Controller adapted to match real facet interface — no code change to the Facet needed.

**WebhookInbox status values:** Plan mentioned APPROVED/PROCESSED; schema uses PENDING/PROCESSING/DONE/FAILED. Implementation follows the schema definition.

## Known Stubs

None. All implementations are functional:
- TransferController delegates to real TransferRegistryFacet
- processWebhookInbox queries real WebhookInbox records and calls real BillingFacet
- SchedulerService cron jobs all have real handlers

## Threat Surface Scan

No new security-relevant surfaces beyond those documented in the plan's threat model:
- T-03-01 (Elevation of Privilege): mitigated — secureContext sourced from middleware
- T-03-02 (Tampering): mitigated — terminal states proven by regression tests
- T-03-03 (Spoofing): mitigated — existing HMAC validation confirmed by webhook tests
- T-03-04 (DoS): mitigated — WebhookInbox cron job with batch limit of 10

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/controllers/TransferController.ts | FOUND |
| tests/transfer-rest.test.ts | FOUND |
| tests/lifecycle-diamond.test.ts | FOUND |
| src/services/SchedulerService.ts | FOUND |
| src/services/core-facets/BillingFacet.ts | FOUND |
| commit de9b2c2 (RED tests) | FOUND |
| commit ba6340a (GREEN transfer route) | FOUND |
| commit 4c73c91 (lifecycle regression tests) | FOUND |
| commit adcd50f (WebhookInbox cron) | FOUND |
| 28 tests passing across 4 test files | VERIFIED |
| npm run build compiles without errors | VERIFIED |
