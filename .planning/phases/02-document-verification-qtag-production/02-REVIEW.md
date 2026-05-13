---
phase: 02-document-verification-qtag-production
status: clean
reviewed: 2026-05-13
open_findings: 0
fixed_findings: 2
---

# Phase 02 Code Review

## Scope

Reviewed source changes from:

- `2cf13a7` - public document verification and EventLog idempotency
- `c9b7503` - tenant-scoped QTAG KMS secrets and commissioning path
- `c31300b` - denied QTAG tap audit logging
- `a9f5604` - runtime Prisma field/relation corrections

## Findings

No open findings.

## Fixed During Review

### 1. Commissioning EventLog used invalid Prisma fields

- **Severity:** Critical
- **Files:** `src/services/core-facets/CommissioningFacet.ts`, `tests/commissioning.test.ts`
- **Issue:** `eventLog.create()` used `eventType` and `hash`, which are not fields in the `EventLog` model.
- **Fix:** Switched to `origin: 'COMMISSIONING'` and `signatureHash`, with JSON payload preserved.
- **Commit:** `a9f5604`

### 2. SDM verifier used wrong Asset relation name

- **Severity:** Critical
- **Files:** `src/services/SDMVerifierService.ts`, `tests/sdm-verifier.test.ts`
- **Issue:** Asset lookup included `eventLog`, but the Prisma schema relation is `events`.
- **Fix:** Switched the include and anchor extraction to `events`.
- **Commit:** `a9f5604`

## Verification

- `npx vitest run tests/commissioning.test.ts tests/sdm-verifier.test.ts` - passed
- `npx vitest run tests/document-verification.test.ts tests/kms-service.test.ts tests/commissioning.test.ts tests/sdm-verifier.test.ts` - 45 passed
- `npx prisma validate` - passed
- `npm run build` - passed
- `git diff --check` - passed

## Residual Risk

Physical NFC write and lock behavior still requires real NTAG 424 DNA hardware/UAT.
