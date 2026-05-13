---
phase: 02
slug: document-verification-qtag-production
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `package.json` scripts |
| **Quick run command** | `npx vitest run tests/document-verification.test.ts tests/commissioning.test.ts tests/sdm-verifier.test.ts` |
| **Full suite command** | `npm run build && npx vitest run tests/document-verification.test.ts tests/commissioning.test.ts tests/sdm-verifier.test.ts` |
| **Estimated runtime** | ~60 seconds |

## Sampling Rate

- **After every task commit:** Run the plan-specific `npx vitest run ...` command.
- **After every plan wave:** Run `npm run build && npx vitest run tests/document-verification.test.ts tests/commissioning.test.ts tests/sdm-verifier.test.ts`.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 90 seconds.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | DOC-01 | T-02-01 | Public route is unauthenticated and canonical at `/api/v1/public/verify/document/:hash` | unit/route | `npx vitest run tests/document-verification.test.ts` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | DOC-02 | T-02-02 | Duplicate `documentHash` is idempotent per tenant | unit | `npx vitest run tests/document-verification.test.ts` | ✅ | ⬜ pending |
| 02-01-03 | 01 | 1 | DOC-03 | T-02-03 | Public proof excludes tenant secret, owner, and metadata fields | unit/route | `npx vitest run tests/document-verification.test.ts` | ✅ | ⬜ pending |
| 02-01-04 | 01 | 1 | DOC-02 | T-02-02 | Schema uniqueness is pushed after `EventLog` constraint change | CLI | `npx prisma db push` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 2 | QTAG-01 | T-02-04 | Commissioning uses configured tenant-scoped KMS material and no production stub | unit | `npx vitest run tests/commissioning.test.ts tests/kms-service.test.ts` | ✅ | ⬜ pending |
| 02-02-02 | 02 | 2 | QTAG-01 | T-02-05 | Plaintext SDM/write keys are one-time only; wrapped keys persist | unit | `npx vitest run tests/commissioning.test.ts` | ✅ | ⬜ pending |
| 02-02-03 | 02 | 2 | QTAG-01 | T-02-04 | `TenantSecret` schema is pushed after KMS registry changes | CLI | `npx prisma db push` | ✅ | ⬜ pending |
| 02-03-01 | 03 | 3 | QTAG-02 | T-02-06 | Suspicious QTAGs return public `DENIED` shape with 403 | unit | `npx vitest run tests/sdm-verifier.test.ts` | ✅ | ⬜ pending |
| 02-03-02 | 03 | 3 | QTAG-02 | T-02-07 | Identified suspicious QTAGs create `DeviceTapLog`; unknown tags do not | unit | `npx vitest run tests/sdm-verifier.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Physical NTAG 424 DNA write and lock after write | QTAG-01 | Requires real NFC writer and tag hardware | Run `commissioning.start`, write returned `pages` with returned `writeKey`, call `commissioning.confirm(success=true)`, and verify `lockAfterWrite` is true in production. |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
