---
phase: 01-core-gap-closure-production-hardening
plan: 02
subsystem: database
tags: [postgresql, prisma, skip-locked, concurrency, algorand, diamond-pattern]

# Dependency graph
requires:
  - phase: 01-core-gap-closure-production-hardening/plan-01
    provides: "QuantumSignerService, CircuitBreakerService, env var guards — base security layer"
provides:
  - "SELECT FOR UPDATE SKIP LOCKED in AnchorQueueService prevents double-processing in rolling deploys"
  - "document.verify selector registered in FacetRegistry — reachable via POST /api/v1/diamond"
  - "DocumentVerificationFacet.verifyByHash returns { verified: boolean } aligned with existing tests"
  - "AlgorandAnchorFacet.anchorEvent() logs every anchor as ChainTransaction with tenantId always populated"
affects: ["phase 3 DLT workers", "phase 5 escrow", "document verification subsystem"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "$queryRaw FOR UPDATE SKIP LOCKED inside $transaction for distributed queue locking"
    - "tenantId always sourced from EventLog on anchorEvent() — never from caller (cross-tenant isolation)"
    - "Anchor log in ChainTransaction: non-blocking (try/catch) to avoid aborting DLT operation on log failure"

key-files:
  created:
    - tests/anchor-queue-skip-locked.test.ts
    - tests/chain-transaction-tenant.test.ts
  modified:
    - src/services/AnchorQueueService.ts
    - src/services/core-facets/DocumentVerificationFacet.ts
    - src/diamond/FacetRegistry.ts
    - src/routes/v1/publicRoutes.ts
    - src/services/core-facets/AlgorandAnchorFacet.ts
    - tests/scheduler.test.ts

key-decisions:
  - "SKIP LOCKED tests in separate file (anchor-queue-skip-locked.test.ts) to avoid vi.mock conflicts with scheduler.test.ts"
  - "DocumentVerificationFacet rewritten with slimmer response shape: { verified, assetId, assetStatus, dltTxId, anchoredAt, eventId, issuerId } — eliminates unused PublicAssetPanel type"
  - "ChainTransaction logging in anchorEvent() is non-blocking (catch + log): anchor must not fail because of a DB log write"
  - "tenantId in ChainTransaction always sourced from EventLog.tenantId fetched at start of anchorEvent() — not from caller"

patterns-established:
  - "Pattern: $queryRaw FOR UPDATE SKIP LOCKED inside prisma.$transaction for distributed batch locking"
  - "Pattern: immediately updateMany(dltTxId: PROCESSING) inside same transaction as SELECT — defense in depth"
  - "Pattern: non-blocking try/catch around audit/log writes inside service methods"

requirements-completed: [SEC-04, SEC-05, SEC-06]

# Metrics
duration: 30min
completed: 2026-05-08
---

# Phase 1 Plan 02: Production Security Gaps Summary

**Distributed queue locking via PostgreSQL SKIP LOCKED, document.verify selector wired into Diamond routing, and ChainTransaction always tenant-scoped via AlgorandAnchorFacet**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-08T03:50:00Z
- **Completed:** 2026-05-08T04:00:00Z
- **Tasks:** 3 (each TDD: RED → GREEN)
- **Files modified:** 7

## Accomplishments

- SEC-04: `AnchorQueueService.processQueue()` now wraps the SELECT in `$transaction($queryRaw FOR UPDATE SKIP LOCKED)` — two parallel workers cannot claim the same EventLog row simultaneously
- SEC-05: `DocumentVerificationFacet.verifyByHash()` rewritten to return `{ verified: boolean, assetId, assetStatus, dltTxId, anchoredAt, eventId, issuerId }` — aligned with all existing tests; `document.verify` selector registered in FacetRegistry
- SEC-06: Every successful `anchorEvent()` call in `AlgorandAnchorFacet` now logs a `ChainTransaction` record with `tenantId` sourced from the originating `EventLog`

## Task Commits

Each task was committed atomically (TDD: test commit → feat commit):

1. **Task 1: SKIP LOCKED (SEC-04) — tests** - `fcd0e72` (test)
2. **Task 1: SKIP LOCKED (SEC-04) — implementation** - `51fc07d` (feat)
3. **Task 2: DocumentVerificationFacet + document.verify (SEC-05)** - `dba6b77` (feat)
4. **Task 3: ChainTransaction tenantId (SEC-06) — tests** - `6a788ee` (test)
5. **Task 3: ChainTransaction tenantId (SEC-06) — implementation** - `3501e54` (feat)

## SQL Pattern for SEC-04

The final SKIP LOCKED query inside `AnchorQueueService.processQueue()`:

```sql
SELECT id, "assetId", "tenantId", "signatureHash"
FROM "EventLog"
WHERE status IN ('APPROVED', 'PENDING_FUNDS')
  AND "dltTxId" IS NULL
  AND "signatureHash" IS NOT NULL
ORDER BY id ASC
LIMIT 10
FOR UPDATE SKIP LOCKED
```

Run inside `prisma.$transaction()`. Immediately followed by `updateMany(dltTxId: 'PROCESSING')` in the same transaction — defense in depth.

## Selectors Before/After (SEC-05)

**Before:** `document.verify` was absent from `FacetRegistry.ts` → POST /api/v1/diamond returned 404

**After:** `FacetRegistry.ts` contains:
```typescript
'document.verify': (_ctx: any, payload: any) => DocumentVerificationFacet.verifyByHash(payload.hash),
```

## ChainTransaction.create Call Sites Audit (SEC-06)

| File | Call site | tenantId present? |
|------|-----------|------------------|
| `src/services/core-facets/AlgorandAnchorFacet.ts` | line ~99 | YES — `event.tenantId` (fetched from EventLog at start of method) |
| `src/services/multi-chain/AlgorandAdapter.ts` | line 468 | Uses `tenantId: 'SYSTEM'` for escrow/transfer ops (out of scope for SEC-06 — those are non-anchor flows; deferred to Phase 3) |
| `src/services/multi-chain/SolanaAdapter.ts` | line 501 | Uses caller-provided tenantId (out of scope for SEC-06) |
| `src/services/multi-chain/SorobanAdapter.ts` | line 396 | Uses caller-provided tenantId (out of scope for SEC-06) |
| `src/services/multi-chain/PolygonAdapter.ts` | line 353 | Uses caller-provided tenantId (out of scope for SEC-06) |
| `src/services/multi-chain/EthAdapter.ts` | line 351 | Uses caller-provided tenantId (out of scope for SEC-06) |

**SEC-06 scope was specifically `AlgorandAnchorFacet` (the primary anchor path)**. The multi-chain adapters use `tenantId: 'SYSTEM'` for internal ops — that is a separate gap deferred to Phase 3 (DLT Workers).

## Files Created/Modified

- `src/services/AnchorQueueService.ts` — replaced `findMany` with `$transaction($queryRaw FOR UPDATE SKIP LOCKED)`
- `src/services/core-facets/DocumentVerificationFacet.ts` — rewritten response shape `{verified}`, removed unused `PublicAssetPanel` type
- `src/diamond/FacetRegistry.ts` — added `DocumentVerificationFacet` import + `document.verify` selector
- `src/routes/v1/publicRoutes.ts` — updated `/verify/document/:hash` handler to use `result.verified`
- `src/services/core-facets/AlgorandAnchorFacet.ts` — added `chainTransaction.create` with `tenantId: event.tenantId`
- `tests/anchor-queue-skip-locked.test.ts` — 4 tests for SKIP LOCKED concurrency
- `tests/chain-transaction-tenant.test.ts` — 3 tests for ChainTransaction tenantId
- `tests/scheduler.test.ts` — cleaned up (removed conflicting mock block)

## Decisions Made

- **SKIP LOCKED tests in separate file**: Vitest hoists `vi.mock()` calls; two `vi.mock('../src/config/prisma')` in the same file create conflicts. Moved AnchorQueueService tests to `anchor-queue-skip-locked.test.ts`.
- **DocumentVerificationFacet slim response**: Removed `PublicAssetPanel` struct (name, sku, serialNumber, pqcSigned, dltExplorerUrl) — tests expect a flatter shape. Chain explorer URL should be built client-side using `dltTxId`.
- **Anchor log is non-blocking**: `ChainTransaction.create` inside a try/catch in `anchorEvent()`. A DB write failure must never abort an already-submitted Algorand transaction.
- **Multi-chain adapters deferred**: `AlgorandAdapter`, `SolanaAdapter` etc. using `tenantId: 'SYSTEM'` is out of scope for SEC-06 (applies to escrow/transfer, not anchor queue). Noted in deferred items.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mock conflict in scheduler.test.ts**
- **Found during:** Task 1 (writing SKIP LOCKED tests)
- **Issue:** Adding a second `vi.mock('../src/config/prisma')` block to `scheduler.test.ts` caused the mock to not be applied (Vitest hoisting conflict)
- **Fix:** Moved AnchorQueueService tests to a dedicated `anchor-queue-skip-locked.test.ts` file; cleaned up scheduler.test.ts
- **Files modified:** tests/scheduler.test.ts, tests/anchor-queue-skip-locked.test.ts (new)
- **Verification:** All 9 tests pass across both files
- **Committed in:** 51fc07d (Task 1 feat commit)

**2. [Rule 1 - Bug] DocumentVerificationFacet response shape mismatch**
- **Found during:** Task 2 pre-analysis (tests already existed in document-verification.test.ts)
- **Issue:** Existing tests expected `{ verified, assetId, assetStatus, dltTxId, anchoredAt, eventId, issuerId }` but implementation returned `{ valid, asset: PublicAssetPanel }` — completely different shape
- **Fix:** Rewrote `DocumentVerificationFacet` to return the shape expected by the tests (aligned with spec in plan)
- **Files modified:** src/services/core-facets/DocumentVerificationFacet.ts
- **Verification:** 8/8 document-verification tests pass
- **Committed in:** dba6b77 (Task 2 feat commit)

---

**Total deviations:** 2 auto-fixed (2x Rule 1 - Bug)
**Impact on plan:** Both fixes were necessary for tests to pass. No scope creep.

## Known Stubs

None — all data is wired. The `dltExplorerUrl` field was intentionally removed from the response (test contract doesn't include it; chain-specific URL building is a client-side concern).

## Threat Flags

None — no new network endpoints or auth paths introduced. Changes are internal service corrections.

## Issues Encountered

- Vitest `vi.mock()` hoisting: when two mock factories target the same module path within the same test file, the second one silently wins (or conflicts). Solved by splitting into separate test files.

## Next Phase Readiness

- Phase 1 Plan 02 complete: SEC-04, SEC-05, SEC-06 closed
- AnchorQueueService is now safe for rolling deploys
- `document.verify` is reachable via Diamond router
- `ChainTransaction` has tenant-scoped anchor logs
- Phase 1 Plan 03 (Wave 2) can proceed

---
*Phase: 01-core-gap-closure-production-hardening*
*Completed: 2026-05-08*
