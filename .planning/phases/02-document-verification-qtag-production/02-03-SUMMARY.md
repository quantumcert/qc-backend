---
phase: 02-document-verification-qtag-production
plan: 03
subsystem: security
tags: [qtag, sdm, device-tap-log, public-scan]
requires:
  - phase: 02-document-verification-qtag-production
    provides: CommissioningFacet SDM key references from 02-02
provides:
  - DeviceTapLog audit records for identifiable denied QTAG scans
  - Preserved public /api/v1/scan DENIED and 400/403 contract
affects: [phase-2, qtag-scan, fraud-audit]
tech-stack:
  added: []
  patterns: [denied-tap-audit, public-scan-contract-test]
key-files:
  created: []
  modified:
    - src/services/SDMVerifierService.ts
    - tests/sdm-verifier.test.ts
key-decisions:
  - "DEVICE_NOT_FOUND without reliable device identification does not create DeviceTapLog."
  - "Public scan response keeps status/reason/message and HTTP mapping unchanged."
patterns-established:
  - "Denied QTAG reasons map to TapVerdict only after device identification."
requirements-completed: [QTAG-02]
duration: 2 min
completed: 2026-05-13
---

# Phase 02 Plan 03: Suspicious QTAG Audit Summary

**Identifiable QTAG rejections now create DeviceTapLog records while public scan responses remain compatible**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-13T22:19:00Z
- **Completed:** 2026-05-13T22:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `SDMVerifierService.logDeniedTap()` mapping `MAC_INVALID`, `REPLAY_ATTACK`, `RELAY_ATTACK`, and `DEVICE_INACTIVE` to `TapVerdict`.
- Preserved no-log behavior for `DEVICE_NOT_FOUND`, missing keys, decrypt failure, and UID mismatch.
- Added route-level coverage for `/api/v1/scan`: missing params 400, `INVALID_INPUT` 400, `DENIED` 403, `APPROVED` 200.

## Task Commits

1. **Denied tap audit helper and scan contract tests** - `c31300b` (`feat(02-03)`)
2. **Runtime Prisma relation alignment for scan asset lookup** - `a9f5604` (`fix(02)`)

## Files Created/Modified

- `src/services/SDMVerifierService.ts` - logs identifiable denied taps with correct `TapVerdict`.
- `tests/sdm-verifier.test.ts` - covers denial logging and public scan HTTP contract.

## Decisions Made

- Denied tap logging is synchronous with the verifier result for identifiable devices.
- Unknown or unreliable device identity intentionally produces no forensic log to avoid false attribution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] SDM asset lookup used wrong Prisma relation name**
- **Found during:** Inline code review after plan execution
- **Issue:** `SDMVerifierService` queried `Asset.include.eventLog`, but the schema relation is `Asset.events`; real Prisma runtime would reject valid scan lookups.
- **Fix:** Switched the include and response extraction to `events`.
- **Files modified:** `src/services/SDMVerifierService.ts`, `tests/sdm-verifier.test.ts`
- **Verification:** `npx vitest run tests/commissioning.test.ts tests/sdm-verifier.test.ts`, `npm run build`
- **Committed in:** `a9f5604`

---

**Total deviations:** 1 auto-fixed (blocking runtime bug)
**Impact on plan:** Fix is in-scope for public QTAG scan verification and prevents a real runtime failure.

## Issues Encountered

None.

## Verification

- `npx vitest run tests/sdm-verifier.test.ts` - 12 passed
- `npm run build` - passed
- `git diff --check` - passed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 2 automated backend checks are green; physical QTAG write/lock remains the manual UAT item.

## Self-Check: PASSED

---
*Phase: 02-document-verification-qtag-production*
*Completed: 2026-05-13*
