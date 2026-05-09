---
phase: 1
slug: core-gap-closure-production-hardening
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-08
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
| - | 01 | 1 | SEC-01 | KMS deriva chave determinística de QUANTUM_CERT_SECRET | unit | `npm test -- tests/post-quantum-crypto.test.ts` | ✅ | ⬜ pending |
| - | 01 | 1 | SEC-02 | verifySignature() retorna false para sig inválida | unit | `npm test -- tests/post-quantum-crypto.test.ts` | ✅ | ⬜ pending |
| - | 01 | 1 | SEC-03 | CircuitBreaker rejeita signature vazia/inválida | unit | `npm test -- tests/security-regression.test.ts` | ✅ | ⬜ pending |
| - | 01 | 1 | SEC-04 | Dois workers não processam mesmo EventLog | unit | `npm test -- tests/scheduler.test.ts` | ✅ | ⬜ pending |
| - | 01 | 1 | SEC-05 | `document.verify` selector retorna resultado (não 404) | unit | `npm test -- tests/document-verification.test.ts` | ✅ | ⬜ pending |
| - | 02 | 1 | SEC-06 | ChainTransaction criada com tenantId preenchido | unit | `npm test -- tests/chain-transaction-tenant.test.ts` | ✅ inline (Plan 02 Task 3, TDD) | ⬜ pending |
| - | 02 | 1 | CORE-01 | `BURNED → ACTIVE` é rejeitado com 422 | unit | `npm test -- tests/lifecycle-diamond.test.ts` | ✅ | ⬜ pending |
| - | 02 | 1 | CORE-02 | `PATCH /assets/:id/lifecycle` retorna 200 | unit | `npm test -- tests/transfer-diamond.test.ts` | ✅ (adaptar) | ⬜ pending |
| - | 02 | 1 | CORE-03 | AnchorQueue é triggerado pelo cron | unit | `npm test -- tests/scheduler.test.ts` | ✅ | ⬜ pending |
| - | 02 | 1 | CORE-04 | Webhook com HMAC inválido retorna 401 | unit | `npm test -- tests/webhook.test.ts` | ✅ | ⬜ pending |
| - | 04 | 2 | CORE-05 | Contribuição de não-auditor cria PendingContribution | unit | `npm test -- tests/curation-facet.test.ts` | ✅ inline (Plan 04 Task 2, TDD) | ⬜ pending |
| - | 04 | 2 | CORE-06 | OPERATOR aprova PendingContribution → EventLog criado | unit | `npm test -- tests/curation-facet.test.ts` | ✅ inline (Plan 04 Task 2, TDD) | ⬜ pending |

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
