---
phase: 04-b2b-admin-operations-console
plan: 01
subsystem: database-auth
tags: [prisma, platform-admin, tenant-admin, tenant-quantum, backfill]

requires:
  - phase: 03-pluggable-dlt-workers-stellar-soroban-priority
    provides: "tenant-scoped backend foundation and Stellar-ready DLT seams"
provides:
  - "Phase 4 canonical Prisma schema for tenant users, memberships, admin audit, request audit, ledgers, payments, QTAG fulfillment and migration runs"
  - "Explicit Platform Admin/Tenant Admin authorization boundary separate from ApiKeyRole.ADMIN"
  - "Local database synced with Phase 4 schema without requiring --accept-data-loss"
affects: [phase-04-admin, phase-04-backfill, phase-04-qtag, phase-05-b2b]

tech-stack:
  added: []
  patterns: [prisma-schema-foundation, explicit-admin-actor, reason-required-admin-mutations]

key-files:
  created:
    - src/middleware/platformAdminAuth.ts
    - src/services/core-facets/AdminAuthorizationFacet.ts
    - tests/admin-authorization.test.ts
    - tests/tenant-backfill.test.ts
  modified:
    - prisma/schema.prisma
    - src/middleware/rbacGuard.ts
    - src/types/index.ts

key-decisions:
  - "ApiKeyRole.ADMIN remains a tenant API-key role and does not grant Quantum Platform Admin privileges."
  - "EncodingSession retry support uses an index on fulfillmentOrderId/attemptNo instead of a unique constraint to avoid local db push data-loss warnings."
  - "Tenant Quantum/backfill foundation lives in Phase 4; Phase 5 remains B2B external readiness."

patterns-established:
  - "Admin actor metadata is resolved from canonical TenantUser/TenantMembership, then attached to AuthenticatedRequest as adminActor/adminScope."
  - "Privileged admin mutations must provide a reason through body.reason or x-admin-reason before downstream handlers execute."
  - "Phase 4 operational balances and queues start from immutable ledger/order models, not mutable counters."

requirements-completed: [ADMIN-01, ADMIN-07, ADMIN-08, ID-01, ID-02]

duration: 18min
completed: 2026-05-17
---

# Phase 04 Plan 01: Canonical Schema And Admin Authorization Summary

**Prisma schema foundation plus explicit Platform Admin/Tenant Admin authorization boundary for the Phase 4 admin console and Tenant Quantum backfill.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-17T06:17:00Z
- **Completed:** 2026-05-17T06:35:47Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added Phase 4 canonical schema models for tenant users, memberships, commercial profile, admin audit, API request audit, payments, credit ledger, QTAG ledger/fulfillment and migration tracking.
- Added `AdminAuthorizationFacet` and `platformAdminAuth` middleware so Platform Admin and Tenant Admin are enforced server-side, separate from API-key RBAC.
- Synced the local PostgreSQL database with the new schema using `npm run db:push`.

## Task Commits

1. **Task 1: Add canonical Phase 4 schema** - `d87c323` (feat)
2. **Task 2: Add server-side admin authorization** - `637384d` (feat)
3. **Task 3: Apply schema locally without data-loss flag** - `c265aa3` (fix)

## Files Created/Modified

- `prisma/schema.prisma` - Added Tenant status, commercial profile, canonical users/memberships, audit/request audit, commercial ledgers, QTAG fulfillment and migration models.
- `src/services/core-facets/AdminAuthorizationFacet.ts` - Resolves admin actors and enforces Platform Admin/Tenant Admin roles.
- `src/middleware/platformAdminAuth.ts` - Express middleware for Platform Admin, Tenant Admin and reason-required gates.
- `src/types/index.ts` - Added admin actor/scope request context types.
- `src/middleware/rbacGuard.ts` - Documented that API-key ADMIN is not Quantum Platform Admin.
- `tests/admin-authorization.test.ts` - Covers schema, Platform Admin, Tenant Admin scoping, API-key ADMIN separation and reason enforcement.
- `tests/tenant-backfill.test.ts` - Covers migration and commercial/QTAG schema foundation.

## Decisions Made

- Kept legacy-compatible fields such as `Tenant.isActive`, `Owner.ownerRef` and `Device.isActive` while adding Phase 4 canonical fields.
- Used `TenantMembershipRole.PLATFORM_ADMIN` under the Quantum tenant as the Platform Admin signal.
- Replaced the planned unique constraint on `EncodingSession(fulfillmentOrderId, attemptNo)` with an index after Prisma warned about possible data-loss during `db:push`; idempotency will be enforced in the QTAG service layer in Plan 05.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided Prisma data-loss gate during schema push**
- **Found during:** Task 3 (Apply schema in development database)
- **Issue:** `npm run db:push` stopped on a Prisma warning for a new unique constraint on `EncodingSession(fulfillmentOrderId, attemptNo)`.
- **Fix:** Changed that relation from a unique constraint to an index so the local schema can be pushed without `--accept-data-loss`.
- **Files modified:** `prisma/schema.prisma`
- **Verification:** `npm run db:generate`, `npm run db:push`, targeted tests and `npm run build` passed.
- **Committed in:** `c265aa3`

---

**Total deviations:** 1 auto-fixed (blocking schema push)
**Impact on plan:** No user-facing scope reduction. QTAG retry idempotency remains required in Plan 05 service logic.

## Issues Encountered

- `npm run db:push` initially failed with Prisma's data-loss warning. The schema was adjusted and the push passed without using `--accept-data-loss`.

## User Setup Required

None - no external service configuration required.

## Verification

```bash
npm run db:generate
npm run db:push
npm test -- --run tests/admin-authorization.test.ts tests/tenant-backfill.test.ts
npm run build
```

All commands passed after the schema index adjustment.

## Next Phase Readiness

Plan 02 can now use the canonical tenant status/profile schema and the explicit admin authorization boundary for tenant lifecycle operations.

---
*Phase: 04-b2b-admin-operations-console*
*Completed: 2026-05-17*
