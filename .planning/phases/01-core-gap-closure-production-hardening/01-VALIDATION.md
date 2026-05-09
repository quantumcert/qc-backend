---
phase: 1
slug: core-gap-closure-production-hardening
status: reviewed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-08
audited: 2026-05-09
last_audit: 2026-05-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.0.4 |
| **Config file** | `vitest.config.ts` (raiz do projeto) |
| **Quick run command** | `npm test -- --reporter=verbose 2>&1 | tail -20` |
| **Full suite command** | `npm test && npm run test:e2e` |
| **Estimated runtime** | ~30 seconds (unit) / ~90 seconds (e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=verbose 2>&1 | tail -20`
- **After every plan wave:** Run `npm test && npm run test:e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| - | 01 | 1 | SEC-01 | KMS deriva chave determinística de QUANTUM_CERT_SECRET, recusa chave efêmera fora de test e zeroiza cache in-place | unit | `npx vitest run tests/kms-service.test.ts` | ✅ | ✅ green |
| - | 01 | 1 | SEC-02 | verifySignature() retorna false para sig inválida | unit | `npx vitest run tests/quantum-signer-verify.test.ts` | ✅ | ✅ green |
| - | 01 | 1 | SEC-03 | CircuitBreaker rejeita signature vazia/inválida | unit | `npx vitest run tests/circuit-breaker-security.test.ts` | ✅ | ✅ green |
| - | 02 | 1 | SEC-04 | Dois workers não processam mesmo EventLog | unit | `npx vitest run tests/anchor-queue-skip-locked.test.ts` | ✅ | ✅ green |
| - | 02 | 1 | SEC-05 | `document.verify` selector retorna resultado (não 404) e respostas negativas públicas são uniformes | unit | `npx vitest run tests/document-verification.test.ts` | ✅ | ✅ green |
| - | 02 | 1 | SEC-06 | ChainTransaction criada com tenantId preenchido | unit | `npx vitest run tests/chain-transaction-tenant.test.ts` | ✅ inline (Plan 02 Task 3, TDD) | ✅ green |
| - | 03 | 1 | CORE-01 | `BURNED → ACTIVE` é rejeitado com 422 | unit | `npx vitest run tests/lifecycle-diamond.test.ts` | ✅ | ✅ green |
| - | 03 | 1 | CORE-02 | `PATCH /assets/:id/transfer` inicia transferência com paymentLink e exige idempotency key | unit | `npx vitest run tests/transfer-rest.test.ts` | ✅ | ✅ green |
| - | 03 | 1 | CORE-03 | AnchorQueue é triggerado pelo cron | unit | `npx vitest run tests/scheduler.test.ts` | ✅ | ✅ green |
| - | 03 | 1 | CORE-04 | Webhook com HMAC inválido retorna 401; WebhookInbox é processado por cron e claim atômico | unit | `npx vitest run tests/webhook.test.ts tests/scheduler.test.ts tests/billing-facet.test.ts` | ✅ | ✅ green |
| - | 04 | 2 | CORE-05 | Contribuição de não-auditor cria PendingContribution | unit | `npm test -- tests/curation-facet.test.ts` | ✅ inline (Plan 04 Task 2, TDD) | ✅ green |
| - | 04 | 2 | CORE-06 | OPERATOR aprova PendingContribution → EventLog criado | unit | `npm test -- tests/curation-facet.test.ts` | ✅ inline (Plan 04 Task 2, TDD) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> **Nota:** Os arquivos de teste novos (`tests/curation-facet.test.ts` e `tests/chain-transaction-tenant.test.ts`) são
> criados **inline via TDD** dentro das tasks que implementam suas features (red-first), não como Wave 0 separada.
> Plan 04 Task 2 cria `tests/curation-facet.test.ts` como parte do ciclo TDD do CurationFacet.
> Plan 02 Task 3 cria `tests/chain-transaction-tenant.test.ts` como parte do ciclo TDD do tenantId em ChainTransaction.
>
> Esta abordagem é equivalente a Wave 0 (testes existem antes do código de produção passar) e satisfaz Nyquist:
> nenhuma task depende de teste inexistente — todas têm `<automated>` apontando para arquivo que existe ao final da task.

*Infraestrutura de teste existente (vitest + fixtures) cobre todos os demais requisitos.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Restart do servidor não invalida wallets Falcon | SEC-01 | Requer ciclo real de restart | 1. Criar tenant, 2. Reiniciar servidor, 3. Assinar com chave — deve ser a mesma |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (testes inline TDD = Wave 0 equivalente)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (via TDD inline)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved

---

## Validation Audit — 2026-05-09

**Auditor:** gsd-nyquist-auditor
**Stance:** adversarial (assume unmet until proven)
**Suite run:** `npx vitest run` — 268 passed (36 files)

### Test Reference Corrections

| Requirement | Old Reference | New Reference | Reason |
|-------------|---------------|---------------|--------|
| SEC-01 | `tests/post-quantum-crypto.test.ts` | `tests/kms-service.test.ts` | `post-quantum-crypto` cobre Falcon verify genérico; SEC-01 exige KMS determinístico, recusa de chave efêmera runtime e zeroização |
| SEC-02 | `tests/post-quantum-crypto.test.ts` | `tests/quantum-signer-verify.test.ts` | Plan 01-01 SUMMARY confirma arquivo criado em TDD RED/GREEN para SEC-02 especificamente |
| SEC-03 | `tests/security-regression.test.ts` | `tests/circuit-breaker-security.test.ts` | Plan 01-01 SUMMARY confirma arquivo criado em TDD RED/GREEN para CircuitBreaker (Task 2) |
| SEC-04 | `tests/scheduler.test.ts` | `tests/anchor-queue-skip-locked.test.ts` | Plan 01-02 SUMMARY documenta separação intencional por conflito de vi.mock hoisting |
| CORE-02 | `tests/transfer-diamond.test.ts` | `tests/transfer-rest.test.ts` | Plan 01-03 SUMMARY confirma criação de transfer-rest.test.ts (5 testes REST) como arquivo primário para CORE-02 |
| CORE-04 | `tests/webhook.test.ts` | `tests/webhook.test.ts` + `tests/scheduler.test.ts` + `tests/billing-facet.test.ts` | Review-fix adicionou regressão para claim atômico do WebhookInbox em BillingFacet |

### Finding Classification

All 12 requirements: **FILLED** — tests exist, all pass, behavior verified.

No BLOCKERs. No WARNINGs. No SKIPs.

---

## Validation Audit — 2026-05-09 (post-review-fix)

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

### Resolved Gaps

| Requirement | Gap | Resolution |
|-------------|-----|------------|
| SEC-01 | Validation map pointed to Falcon crypto tests instead of KMS behavior | Added `tests/kms-service.test.ts` covering deterministic `QUANTUM_CERT_SECRET` derivation, runtime refusal of ephemeral keys outside test mode, and in-place cache zeroization |
| SEC-05 | Validation claimed `document.verify` selector reachability, but the test suite only called `DocumentVerificationFacet.verifyByHash` directly | Added selector-level assertion in `tests/document-verification.test.ts` through `FacetRegistry['document.verify']` |

### Map Corrections

| Requirement | Correction |
|-------------|------------|
| SEC-04/05/06 | Plan column corrected from `01` to `02` |
| CORE-01/02/03/04 | Plan column corrected from `02` to `03` |
| CORE-02 | Secure behavior corrected from stale lifecycle route text to `PATCH /assets/:id/transfer` |
| CORE-04 | Added `tests/billing-facet.test.ts` to cover review-fix atomic WebhookInbox claim |

**Suite run:** `npx vitest run tests/kms-service.test.ts tests/document-verification.test.ts tests/billing-facet.test.ts tests/webhook.test.ts tests/scheduler.test.ts tests/anchor-queue-skip-locked.test.ts tests/chain-transaction-tenant.test.ts tests/circuit-breaker-security.test.ts tests/quantum-signer-verify.test.ts tests/lifecycle-diamond.test.ts tests/transfer-rest.test.ts tests/curation-facet.test.ts tests/curation-routes.test.ts`

**Status:** passed — 13 test files, 76 tests.

**Full suite run:** `npx vitest run` — passed, 38 test files, 277 tests.
