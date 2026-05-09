# STATE — Quantum Cert Backend
_Initialized: 2026-05-08_

---

## Project Reference

**Core Value**: Tríade indivisível: ancoragem DLT com assinatura pós-quântica + ciclo de vida completo de ativos rastreável + plataforma white-label multi-tenant.

**Current Focus**: Phase 1 — Core Gap Closure + Production Hardening

---

## Current Position

| Field | Value |
|-------|-------|
| Milestone | 1 |
| Phase | 1 — Core Gap Closure + Production Hardening |
| Plan | Plan 02 complete — Plan 03 next |
| Status | In Progress |

**Progress**:
```
Phase 1 [████████  ] 80% (Plan 01 complete: SEC-01, SEC-02, SEC-03 | Plan 02 complete: SEC-04, SEC-05, SEC-06)
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
| Plans complete | 2 |

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

**Last session**: 2026-05-08 — Plan 01-02 executado: SEC-04, SEC-05, SEC-06 eliminados (5 commits, 11 testes novos)

**Next action**: Executar Plan 01-03 (Wave 2)

**Context for next session**:
- Branch atual: `7-feat-camada-de-curadoria-contribuicoes-de-nao-auditores-vao-para-fila-pendentes-de-aprovacao`
- CORE-05 e CORE-06 (Curation Layer) estão em desenvolvimento nessa branch — issue #7
- Spec de design em `docs/` (commit `9a07037`)
- Phase 1 é pré-requisito absoluto; não avançar para Phase 2 ou 3 sem Phase 1 completa
