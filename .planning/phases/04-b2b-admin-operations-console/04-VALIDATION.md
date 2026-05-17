---
phase: 04
slug: b2b-admin-operations-console
status: implementation_complete_human_uat_pending
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-17
last_validated: 2026-05-17T11:12:24Z
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
| 04-01-01 | 01 | 0 | ADMIN-01, ADMIN-07, ADMIN-08 | T-04-01 | Platform Admin and Tenant Admin are distinct server-side roles | unit/integration | `npm test -- --run tests/admin-authorization.test.ts` | yes | green |
| 04-02-01 | 02 | 1 | ADMIN-02, ADMIN-03 | T-04-02 | Tenant status changes require platform authorization and audit | unit/integration | `npm test -- --run tests/admin-tenant-lifecycle.test.ts` | yes | green |
| 04-03-01 | 03 | 1 | ADMIN-04, ADMIN-08 | T-04-03 | API key raw secret is one-time only; active keys list has prefix/metadata only | unit/integration | `npm test -- --run tests/admin-api-keys.test.ts` | yes | green |
| 04-03-02 | 03 | 1 | ADMIN-04, ADMIN-08 | T-04-04 | API request audit stores no raw API key or sensitive payload | unit/integration | `npm test -- --run tests/api-request-audit.test.ts` | yes | green |
| 04-04-01 | 04 | 2 | ADMIN-05, ADMIN-06, ADMIN-09, ADMIN-10 | T-04-05 | Credit ledger reserves, consumes and releases idempotently | unit/integration | `npm test -- --run tests/credit-ledger.test.ts` | yes | green |
| 04-04-02 | 04 | 2 | ADMIN-10 | T-04-06 | Payment event processing deduplicates provider events before crediting | unit/integration | `npm test -- --run tests/payment-provider-boundary.test.ts` | yes | green |
| 04-05-01 | 05 | 2 | ADMIN-11, ADMIN-12, ADMIN-13 | T-04-07 | QTAG reservation/activation cannot consume entitlement twice | unit/integration | `npm test -- --run tests/qtag-fulfillment.test.ts` | yes | green |
| 04-05-02 | 05 | 2 | ADMIN-12, ADMIN-13 | T-04-08 | Commissioning confirm validates tenant/session/UID and links `Asset.deviceId` | unit/integration | `npm test -- --run tests/commissioning.test.ts` | yes | green |
| 04-06-01 | 06 | 3 | ID-01, ID-02, ID-03, ID-04, ID-05, ID-06 | T-04-09 | Backfill maps B2C users under Tenant Quantum idempotently and cuts over B2C domain writes | integration | `npm test -- --run tests/tenant-backfill.test.ts tests/tenant-user-contracts.test.ts` | yes | green |
| 04-07-01 | 07 | 5 | ADMIN-01, ADMIN-04, ADMIN-05, ADMIN-11, ADMIN-13 | T-04-10 | Dashboard admin procedures enforce platform/tenant scoping server-side | integration | `cd ../qc-dashboard && pnpm exec vitest run server/admin-e2e.test.ts server/admin.tenant-scope.test.ts` | yes | green |
| 04-07-02 | 07 | 5 | ADMIN-01, ADMIN-07, ADMIN-08 | T-04-10 | Tenant Admin cannot read another tenant by passing arbitrary tenantId | integration | `cd ../qc-dashboard && pnpm exec vitest run server/admin.tenant-scope.test.ts` | yes | green |
| 04-07-03 | 07 | 5 | ID-01, ID-02, ID-03, ID-04 | T-04-09 | Dashboard profile identity sync uses canonical backend user/profile Asset contract | integration | `cd ../qc-dashboard && pnpm exec vitest run server/profileIdentityAnchoring.test.ts` | yes | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/admin-authorization.test.ts` - Platform Admin vs Tenant Admin server authorization stubs
- [x] `tests/admin-tenant-lifecycle.test.ts` - tenant status/profile audit stubs
- [x] `tests/admin-api-keys.test.ts` - initial issue/list/rotate/revoke stubs
- [x] `tests/api-request-audit.test.ts` - request audit sanitization stubs
- [x] `tests/credit-ledger.test.ts` - reserve/consume/release/grant/adjust stubs
- [x] `tests/payment-provider-boundary.test.ts` - provider boundary, assinatura inválida, dedupe e crédito pós-confirmação
- [x] `../qc-dashboard/server/admin.credits.test.ts` - procedures tRPC de créditos, compras e fila de pagamentos
- [x] `tests/payment-provider-boundary.test.ts` - provider event idempotency stubs
- [x] `tests/qtag-fulfillment.test.ts` - QTAG entitlement/fulfillment stubs
- [x] `../qc-dashboard/server/admin.qtags.test.ts` - procedures tRPC de QTAG, reserva, release e fila
- [x] `tests/tenant-backfill.test.ts` - Tenant Quantum migration dry-run/execute stubs
- [x] `../qc-dashboard/server/admin.*.test.ts` or equivalent - dashboard admin tRPC authorization stubs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Platform Admin cockpit flow | ADMIN-01..ADMIN-08 | Cross-repo UI and backend behavior | Login as platform admin, create tenant, activate it, issue first API key, rotate/revoke key, confirm audit timeline |
| QTAG physical activation | ADMIN-11..ADMIN-13 | Requires NFC writer/physical tag | Buy/grant QTAG entitlement, assign to Asset, encode via writer, confirm successful scan returns linked Asset |
| Backfill report approval | ADMIN-01, ADMIN-05, ADMIN-09 | Requires human review of migration report | Run dry-run, inspect conflicts/counts, run execute only after report is acceptable |
| Provider receivables contract | ADMIN-10 | Transfero/provider contract is TBD with `qc-business` | Validate provider adapter behavior using fake provider until final provider contract is approved |

---

## Execution Evidence - 2026-05-17

### Backend

- `npm test -- --run` - passed, 54 files, 389 tests.
- `npm run build` - passed.
- `npm test -- --run tests/admin-tenant-lifecycle.test.ts tests/admin-api-keys.test.ts tests/credit-ledger.test.ts` - passed, 28 tests.
- `npm test -- --run tests/qtag-fulfillment.test.ts tests/payment-provider-boundary.test.ts` - passed, 9 tests.
- Scope enforcement regression fixed in legacy route tests by adding explicit mocked API key scopes:
  - `tests/asset-controller.test.ts` -> `assets:write`
  - `tests/curation-routes.test.ts` -> `events:write`
  - `tests/transfer-rest.test.ts` -> `transfers:write`

### Dashboard

- `pnpm exec vitest run server/admin-e2e.test.ts server/admin.tenant-scope.test.ts` - passed, 4 tests.
- `pnpm exec vitest run server/admin.tenant-scope.test.ts server/admin-e2e.test.ts` - passed, 4 tests after switching `/admin/tenant` to backend Tenant Admin read-only routes.
- `pnpm exec vitest run server/admin.qtags.test.ts server/admin.credits.test.ts` - passed, 7 tests.
- `pnpm exec vitest run server/profileIdentityAnchoring.test.ts server/admin.tenant-scope.test.ts` - passed, 25 tests.
- `pnpm test` - passed, 40 files, 172 tests, 3 skipped.
- `pnpm check` - passed.

### Browser Smoke

- `/admin/platform/tenants/:tenantId` -> aba `Team` sem sobreposicao do ultimo select.
- `/admin/tenant` -> visão Tenant Admin carrega dados somente do tenant resolvido pelo contexto.
- `/admin/platform/queues/activations` -> fila de ativações renderiza filtros, estado vazio e paginação sem overflow horizontal.
- `gsd-sdk query audit-uat --raw` -> 0 outstanding verification debt items.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing test files
- [x] No watch-mode flags in verification commands
- [x] Feedback latency target is under 180 seconds per targeted check
- [x] `nyquist_compliant: true` set in frontmatter after Wave 0 stubs exist and first targeted checks pass

**Approval:** implementation complete; human UAT pending for real backfill approval, Transfero/provider contract and physical QTAG commissioning.
