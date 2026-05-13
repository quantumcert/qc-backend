---
phase: 02-document-verification-qtag-production
plan: 02
subsystem: security
tags: [qtag, kms, tenant-secret, commissioning, prisma]
requires:
  - phase: 02-document-verification-qtag-production
    provides: EventLog/document verification schema updates from 02-01
provides:
  - KMS-wrapped tenant-scoped Falcon secret registry
  - CommissioningFacet production path using qtag-commissioning secret
  - Production lockAfterWrite behavior
affects: [phase-2, qtag-commissioning, kms]
tech-stack:
  added: []
  patterns: [tenant-scoped-kms-secret, one-time-plaintext-key-return]
key-files:
  created: []
  modified:
    - src/services/KMSService.ts
    - src/services/core-facets/CommissioningFacet.ts
    - prisma/schema.prisma
    - tests/kms-service.test.ts
    - tests/commissioning.test.ts
key-decisions:
  - "Tenant Falcon material is stored only as KMS-wrapped TenantSecret.encryptedSecret."
  - "commissioning.start fails closed when qtag-commissioning tenant secret is absent or inactive."
patterns-established:
  - "KMS tenant secrets are addressed by tenantId + purpose and never returned except in-memory to callers."
requirements-completed: [QTAG-01]
duration: 3 min
completed: 2026-05-13
---

# Phase 02 Plan 02: QTAG Commissioning KMS Summary

**Tenant-scoped Falcon secret registry and production QTAG commissioning path without zero-filled stubs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-13T22:17:00Z
- **Completed:** 2026-05-13T22:19:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `TenantSecret` with `@@unique([tenantId, purpose])` and Tenant relation.
- Added `KMSService.storeTenantSecretHex()` and `getTenantSecretHex()` for Falcon-512 tenant material.
- Replaced the `CommissioningFacet.start()` production stub and zero secret with `kms.getTenantSecretHex(ctx.tenantId, 'qtag-commissioning')`.
- Preserved one-time return of `sdmMacKey` and `writeKey` while persisting only wrapped SDM key references.
- `lockAfterWrite` now defaults to `true` in production and stays false in test/dev.

## Task Commits

1. **TenantSecret schema, KMS helpers, commissioning production path, tests** - `c9b7503` (`feat(02-02)`)
2. **Runtime Prisma field alignment for commissioning EventLog writes** - `a9f5604` (`fix(02)`)

## Files Created/Modified

- `src/services/KMSService.ts` - adds tenant-scoped secret store/get helpers and fail-closed error code.
- `src/services/core-facets/CommissioningFacet.ts` - uses KMS tenant secret and production `lockAfterWrite`.
- `prisma/schema.prisma` - adds `TenantSecret`.
- `tests/kms-service.test.ts` - covers wrapping, unwrapping, short secret rejection, and missing/inactive fail-closed behavior.
- `tests/commissioning.test.ts` - covers KMS lookup, no plaintext persistence, production lock, and missing secret failure.

## Decisions Made

- `TENANT_SECRET_NOT_CONFIGURED` is the typed operational code for missing/inactive commissioning material.
- Physical NFC write remains manual UAT; backend proves session/key behavior automatically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Commissioning EventLog write used non-schema fields**
- **Found during:** Inline code review after plan execution
- **Issue:** `CommissioningFacet.start()` wrote `eventType` and `hash`, which are not fields on `EventLog`; real Prisma runtime would reject the commissioning event write.
- **Fix:** Replaced them with schema-valid `origin: 'COMMISSIONING'` and `signatureHash`, and kept payload as JSON.
- **Files modified:** `src/services/core-facets/CommissioningFacet.ts`, `tests/commissioning.test.ts`
- **Verification:** `npx vitest run tests/commissioning.test.ts tests/sdm-verifier.test.ts`, `npm run build`
- **Committed in:** `a9f5604`

---

**Total deviations:** 1 auto-fixed (blocking runtime bug)
**Impact on plan:** Fix is in-scope for production commissioning and prevents a real runtime failure.

## Issues Encountered

None.

## Verification

- `npx prisma db push` - passed and generated Prisma Client
- `npx prisma generate` - passed
- `npx vitest run tests/kms-service.test.ts` - 7 passed
- `npx vitest run tests/commissioning.test.ts` - 13 passed
- `npm run build` - passed
- `git diff --check` - passed

## User Setup Required

Before real production commissioning, configure a real Falcon-512 private key per tenant/purpose using `KMSService.storeTenantSecretHex(tenantId, 'qtag-commissioning', privateKeyHex, publicKeyB64)`.

## Next Phase Readiness

Ready for suspicious QTAG scan audit: commissioning now produces wrapped SDM references backed by tenant KMS material.

## Self-Check: PASSED

---
*Phase: 02-document-verification-qtag-production*
*Completed: 2026-05-13*
