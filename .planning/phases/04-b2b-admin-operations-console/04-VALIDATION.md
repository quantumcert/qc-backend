---
phase: 04
slug: b2b-admin-operations-console
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 04 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest in `qc-backend`; Vitest + TypeScript in `qc-dashboard` |
| **Config file** | `vitest.config.ts`; `../qc-dashboard/vitest.config.ts` if present |
| **Quick run command** | `npm test -- --run tests/<target>.test.ts` |
| **Full suite command** | `npm test -- --run` and `cd ../qc-dashboard && pnpm test && pnpm check` |
| **Estimated runtime** | ~60-180 seconds, depending on dashboard suite |

---

## Sampling Rate

- **After every backend task commit:** Run `npm test -- --run tests/<target>.test.ts`
- **After every dashboard task commit:** Run `cd ../qc-dashboard && pnpm test -- <target>` or `cd ../qc-dashboard && pnpm check`
- **After every schema task:** Run `npm run db:generate` and the planned schema push/migration command
- **After every plan wave:** Run `npm test -- --run` plus `cd ../qc-dashboard && pnpm test && pnpm check`
- **Before `$gsd-verify-work`:** backend and dashboard full suites must be green or documented with explicit blockers
- **Max feedback latency:** 180 seconds per targeted check

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | ADMIN-01, ADMIN-07, ADMIN-08 | T-04-01 | Platform Admin and Tenant Admin are distinct server-side roles | unit/integration | `npm test -- --run tests/admin-authorization.test.ts` | no | pending |
| 04-02-01 | 02 | 1 | ADMIN-02, ADMIN-03 | T-04-02 | Tenant status changes require platform authorization and audit | unit/integration | `npm test -- --run tests/admin-tenant-lifecycle.test.ts` | no | pending |
| 04-03-01 | 03 | 1 | ADMIN-04, ADMIN-08 | T-04-03 | API key raw secret is one-time only; active keys list has prefix/metadata only | unit/integration | `npm test -- --run tests/admin-api-keys.test.ts` | no | pending |
| 04-03-02 | 03 | 1 | ADMIN-04, ADMIN-08 | T-04-04 | API request audit stores no raw API key or sensitive payload | unit/integration | `npm test -- --run tests/api-request-audit.test.ts` | no | pending |
| 04-04-01 | 04 | 2 | ADMIN-05, ADMIN-06, ADMIN-09, ADMIN-10 | T-04-05 | Credit ledger reserves, consumes and releases idempotently | unit/integration | `npm test -- --run tests/credit-ledger.test.ts` | no | pending |
| 04-04-02 | 04 | 2 | ADMIN-10 | T-04-06 | Payment event processing deduplicates provider events before crediting | unit/integration | `npm test -- --run tests/payment-provider-boundary.test.ts` | no | pending |
| 04-05-01 | 05 | 2 | ADMIN-11, ADMIN-12, ADMIN-13 | T-04-07 | QTAG reservation/activation cannot consume entitlement twice | unit/integration | `npm test -- --run tests/qtag-fulfillment.test.ts` | no | pending |
| 04-05-02 | 05 | 2 | ADMIN-12, ADMIN-13 | T-04-08 | Commissioning confirm validates tenant/session/UID and links `Asset.deviceId` | unit/integration | `npm test -- --run tests/commissioning.test.ts` | yes | pending |
| 04-06-01 | 06 | 3 | ADMIN-01, ADMIN-02, ADMIN-07 | T-04-09 | Backfill maps B2C users under Tenant Quantum idempotently | integration | `npm test -- --run tests/tenant-backfill.test.ts` | no | pending |
| 04-07-01 | 07 | 3 | ADMIN-01, ADMIN-04, ADMIN-05, ADMIN-11, ADMIN-13 | T-04-10 | Dashboard admin procedures enforce platform/tenant scoping server-side | integration | `cd ../qc-dashboard && pnpm test -- admin` | no | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/admin-authorization.test.ts` - Platform Admin vs Tenant Admin server authorization stubs
- [ ] `tests/admin-tenant-lifecycle.test.ts` - tenant status/profile audit stubs
- [ ] `tests/admin-api-keys.test.ts` - initial issue/list/rotate/revoke stubs
- [ ] `tests/api-request-audit.test.ts` - request audit sanitization stubs
- [ ] `tests/credit-ledger.test.ts` - reserve/consume/release/grant/adjust stubs
- [ ] `tests/payment-provider-boundary.test.ts` - provider event idempotency stubs
- [ ] `tests/qtag-fulfillment.test.ts` - QTAG entitlement/fulfillment stubs
- [ ] `tests/tenant-backfill.test.ts` - Tenant Quantum migration dry-run/execute stubs
- [ ] `../qc-dashboard/server/admin.*.test.ts` or equivalent - dashboard admin tRPC authorization stubs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Platform Admin cockpit flow | ADMIN-01..ADMIN-08 | Cross-repo UI and backend behavior | Login as platform admin, create tenant, activate it, issue first API key, rotate/revoke key, confirm audit timeline |
| QTAG physical activation | ADMIN-11..ADMIN-13 | Requires NFC writer/physical tag | Buy/grant QTAG entitlement, assign to Asset, encode via writer, confirm successful scan returns linked Asset |
| Backfill report approval | ADMIN-01, ADMIN-05, ADMIN-09 | Requires human review of migration report | Run dry-run, inspect conflicts/counts, run execute only after report is acceptable |
| Provider receivables contract | ADMIN-10 | Transfero/provider contract is TBD with `qc-business` | Validate provider adapter behavior using fake provider until final provider contract is approved |

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing test files
- [ ] No watch-mode flags in verification commands
- [ ] Feedback latency target is under 180 seconds per targeted check
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 stubs exist and first targeted checks pass

**Approval:** pending
