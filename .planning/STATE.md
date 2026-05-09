# STATE — Quantum Cert Backend
_Initialized: 2026-05-08_

---

## Project Reference

**Core Value**: Tríade indivisível: ancoragem DLT com assinatura pós-quântica + ciclo de vida completo de ativos rastreável + plataforma white-label multi-tenant.

**Current Focus**: Phase 2 — Document Verification + QTAG Production

---

## Current Position

| Field | Value |
|-------|-------|
| Milestone | 1 |
| Phase | 1 — Core Gap Closure + Production Hardening ✓ → next: Phase 2 |
| Plan | Phase 1 COMPLETE — All 4 plans done |
| Status | Complete |

**Progress**:
```
Phase 1 [██████████] 100% (Plan 01: SEC-01/02/03 | Plan 02: SEC-04/05/06 | Plan 03: CORE-01/02/03/04 | Plan 04: CORE-05/06)
Phase 2 [          ] 0%
Phase 3 [          ] 0%
Phase 4 [          ] 0%
Phase 5 [          ] 0%
Phase 6 [          ] 0%
```

---

## GitHub Project

**Org Project**: https://github.com/orgs/quantumcert/projects/1
**Milestones**: M#1..M#6 criados em quantumcert/qc-backend
**Issue assignment**: #5→M1, #7→M1, #8→M1, #12→M2, #2→M2, #11→M3, #13→M4, #3→M5, #10→M6, #15→M6

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases total | 6 |
| Requirements total (v1) | 41 (36 original + 5 FACET) |
| Requirements mapped | 41/41 |
| Plans written | 4 |
| Plans complete | 4 |

---

## Accumulated Context

### Key Decisions

| Decision | Rationale | Phase |
|----------|-----------|-------|
| Phase 1 before everything | SEC-01 e SEC-02 são blockers catastróficos — chave Falcon efêmera e verifySignature stub podem destruir dados de produção | 1 |
| publicKeyHex→base64 para PostQuantumCrypto | verifySignatureFalcon512 aceita base64; QuantumSignerService aceita hex; conversão feita no método verifySignature | 1 |
| REQUIRED_ENV_VARS gateado por NODE_ENV=production | Evita quebrar dev flow; produção exige QUANTUM_CERT_SECRET, MP_WEBHOOK_SECRET, CIRCUIT_BREAKER_ADMIN_PUBKEY | 1 |
| SKIP LOCKED tests em arquivo separado | vi.mock() hoisting do Vitest conflita quando dois mocks do mesmo módulo existem no mesmo arquivo; solução: anchor-queue-skip-locked.test.ts separado | 1 |
| DocumentVerificationFacet response shape slim | Testes existentes esperam { verified, assetId, assetStatus, dltTxId, anchoredAt, eventId, issuerId } sem PublicAssetPanel — reescrita alinhada com testes | 1 |
| ChainTransaction logging não-bloqueante em anchorEvent() | Log de ChainTransaction dentro de try/catch: falha de DB write não pode abortar uma txn Algorand já submetida | 1 |
| Phase 3 depende só de Phase 1 | DLT Workers não dependem de DOC/QTAG — podem rodar em paralelo com Phase 2 se necessário | 3 |
| Phase 5 depende de Phase 3 + Phase 4 | EscrowFacet usa BullMQ (OPS-05) e TEAL on-chain requer Soroban research concluído | 5 |
| DLT-02 (Solana) mantido em v1 | Solana foi deferido para v2 no REQUIREMENTS.md mas o REQUIREMENTS.md v1 lista DLT-02 explicitamente — mantido em Phase 3 | 3 |
| TransferController payload usa buyerDocument+documentType | Plano mencionava toOwner+reason mas a assinatura real do TransferRegistryFacet é buyerDocument+documentType; controller adaptado sem alterar Facet | 1 |
| WebhookInbox status DONE/FAILED per schema | Plano mencionava PROCESSED/APPROVED mas o schema define PENDING/PROCESSING/DONE/FAILED; implementação segue o schema | 1 |
| CurationFacet não adicionado ao FacetRegistry | Rota pública direta (não via Diamond) — conforme spec 2026-05-08; decisão arquitetural intencional | 1 |
| Tenant isolation via findFirst com {id, tenantId} | Cross-tenant retorna 404 (NOT_FOUND) em vez de 403 — evita information leakage sobre existência de recursos de outros tenants | 1 |

### Research Flags

| Phase | Requer research-phase | Motivo |
|-------|-----------------------|--------|
| Phase 3 | Sim | Soroban contract ABI vs SorobanAdapter.ts + BIP-44 migration strategy |
| Phase 5 | Sim | TEAL escrow on-chain — smart contract requer auditoria de segurança |

### Blockers

_Nenhum blocker ativo._

### Todos

_Nenhum todo pendente._

---

## Session Continuity

**Last session**: 2026-05-09 — Phase 1 aprovada, marcada completa, PR #17 mergeado em `main`. 4/4 plans, 12 requirements (SEC-01..06, CORE-01..06), Nyquist-compliant. Review-fix: 12/15 findings in-scope corrigidos, incluindo todos os 7 Criticals; os 3 avisos restantes foram classificados como dívida técnica não bloqueante, sem impedir o encerramento da fase.

**Phase 1 closure validation**: 2026-05-09 — sem blockers ativos, sem todos pendentes, sem verificação humana pendente. `01-VERIFICATION.md` está `status: passed`, `human_verification: []`; `01-HUMAN-UAT.md` está `status: passed`, `pending: 0`, `blocked: 0`; `01-REVIEW-FIX.md` está `complete_with_non_blocking_deferred_items`, `critical_remaining: 0`, `blocking_remaining: 0`.

**Phase 1 merge**: PR #17 mergeado em `main` em 2026-05-09T04:43:15Z, merge commit `62a12252ca921893641ec7b8c47a9205a5e40306`. Branch remota removida e branch local de trabalho apagada após sincronização.

**Next action**: `/gsd-discuss-phase 2` para iniciar Phase 2

**Context for next session**:
- Branch: `main` atualizada com PR #17 mergeado
- Phase 1 COMPLETA: Falcon-512 real, SKIP LOCKED, Lifecycle, Transfer REST, Curation Layer, review-fix aplicado
- Code review fix report: `.planning/phases/01-core-gap-closure-production-hardening/01-REVIEW-FIX.md` — encerrado sem blocker; WR-01, WR-06, WR-07 postergados como dívida técnica não bloqueante por exigirem mudança cross-cutting/schema
- Phase 2: DOC-01/02/03 (verificação pública) + QTAG-01/02 (commissioning NFC) — depende só de Phase 1
