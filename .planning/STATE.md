---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 04 Plan 02 complete — Plan 03 ready
last_updated: "2026-05-17T06:51:00Z"
progress:
  total_phases: 9
  completed_phases: 3
  total_plans: 17
  completed_plans: 12
  percent: 35
---

# STATE — Quantum Cert Backend

_Initialized: 2026-05-08_

---

## Project Reference

**Core Value**: Tríade indivisível: ancoragem DLT com assinatura pós-quântica + ciclo de vida completo de ativos rastreável + plataforma white-label multi-tenant.

**Workspace Scope**: Produto multi-repo — `qc-backend`, `qc-dashboard`, `qc-home`, `qc-record-module`; decisões de negócio em `qc-business`.

**Current Focus**: Phase 4 — B2B Admin Operations Console (Plan 05 complete; Plan 06 ready)

---

## Current Position

Phase: 04 (b2b-admin-operations-console) — IN_PROGRESS
Plan: 03 of 07 ready
| Field | Value |
|-------|-------|
| Milestone | TBD |
| Phase | 4 — B2B Admin Operations Console |
| Plan | 03 of 07 ready |
| Status | Plan 02 completed on 2026-05-17; tenant lifecycle backend, dashboard admin router and Tenant List/Detail UI are complete |

**Progress**:

```
Phase 1 [██████████] 100% (Plan 01: SEC-01/02/03 | Plan 02: SEC-04/05/06 | Plan 03: CORE-01/02/03/04 | Plan 04: CORE-05/06)
Phase 2 [██████████] 100% (3/3 plans complete; backend verified; physical QTAG UAT blocked)
Phase 3 [██████████] 100% (3/3 plans complete; Stellar UAT passed; PRs merged)
Phase 4 [███████   ] 71% (5/7 plans complete; Plan 06 Tenant Quantum/backfill/cutover ready)
Phase 5 [          ] 0% (B2B Tenant External Readiness — approved after Phase 4)
Phase 6 [          ] 0% (On-chain Asset Identity + Provenance — approved after Phase 5)
Phase 7 [          ] 0% (Scale + Observability — deferred behind identity/on-chain transition)
Phase 8 [          ] 0% (EscrowFacet + Time-Lock Oracle + M2M)
Phase 9 [          ] 0% (Specialized Domain Facets)
```

---

## GitHub Project

**Org Project**: https://github.com/orgs/quantumcert/projects/1
**Milestones**: M#1..M#6 criados em quantumcert/qc-backend
**Issue assignment**: #5→M1, #7→M1, #8→M1, #12→M2, #2→M2, #11→M3, #13→M4, #3→M5, #10→M6, #15→M6

---

## Performance Metrics

| Metric                  | Value                      |
| ----------------------- | -------------------------- |
| Phases total            | 9                          |
| Requirements total (v1) | 73                         |
| Requirements mapped     | 73/73                      |
| Plans written           | 17                         |
| Plans complete          | 12                         |

---

### Plan Execution Metrics

| Plan         | Duration | Tasks   | Files   |
| ------------ | -------- | ------- | ------- |
| Phase 03 P01 | 12 min   | 3 tasks | 9 files |
| Phase 03 P02 | 6 min    | 3 tasks | 9 files |
| Phase 03 P03 | 5 min    | 3 tasks | 6 files |
| Phase 04 P01 | 18 min   | 3 tasks | 7 files |
| Phase 04 P02 | 35 min   | 3 tasks | 14 files |
| Phase 04 P03 | planned  | 3 tasks | 12 files |
| Phase 04 P04 | planned  | 3 tasks | 12 files |
| Phase 04 P05 | planned  | 3 tasks | 10 files |
| Phase 04 P06 | planned  | 3 tasks | 10 files |
| Phase 04 P07 | planned  | 3 tasks | 10 files |

## Accumulated Context

### Key Decisions

| Decision                                                  | Rationale                                                                                                                                                                                                            | Phase |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Phase 1 before everything                                 | SEC-01 e SEC-02 são blockers catastróficos — chave Falcon efêmera e verifySignature stub podem destruir dados de produção                                                                                            | 1     |
| publicKeyHex→base64 para PostQuantumCrypto                | verifySignatureFalcon512 aceita base64; QuantumSignerService aceita hex; conversão feita no método verifySignature                                                                                                   | 1     |
| REQUIRED_ENV_VARS gateado por NODE_ENV=production         | Evita quebrar dev flow; produção exige QUANTUM_CERT_SECRET, MP_WEBHOOK_SECRET, CIRCUIT_BREAKER_ADMIN_PUBKEY                                                                                                          | 1     |
| SKIP LOCKED tests em arquivo separado                     | vi.mock() hoisting do Vitest conflita quando dois mocks do mesmo módulo existem no mesmo arquivo; solução: anchor-queue-skip-locked.test.ts separado                                                                 | 1     |
| DocumentVerificationFacet response shape slim             | Testes existentes esperam { verified, assetId, assetStatus, dltTxId, anchoredAt, eventId, issuerId } sem PublicAssetPanel — reescrita alinhada com testes                                                            | 1     |
| ChainTransaction logging não-bloqueante em anchorEvent()  | Log de ChainTransaction dentro de try/catch: falha de DB write não pode abortar uma txn Algorand já submetida                                                                                                        | 1     |
| Phase 3 depende só de Phase 1                             | DLT Workers não dependem de DOC/QTAG — podem rodar em paralelo com Phase 2 se necessário                                                                                                                             | 3     |
| Phase 8 depende de Phase 6 + Phase 7                      | EscrowFacet usa BullMQ (OPS-05) e lógica on-chain deve vir depois da identidade/proveniência on-chain e da infraestrutura de escala                                                                                  | 8     |
| DLT-02 (Solana) mantido como backlog v1                   | Solana continua no backlog v1, mas está deferido do slice Stellar/hackathon; não é critério de aceite da execução atual da Phase 3                                                                                   | 3     |
| Phase 3 hackathon slice segue 03-SPEC.md                  | Stellar/Soroban é o recorte obrigatório de entrega; x402/micropagamento é nice-to-have via env desligada por default; DLT-02 Solana e DLT-05 lastScannedBlock ficam explicitamente deferidos, não marcados como done | 3     |
| Stellar-first, Solana-ready                               | Phase 3 deve fazer Stellar funcionar agora, mas manter `tenant.targetChain`, `DLTAdapterFactory`, `IDLTAdapter` e `ChainTransaction.chain` como seams atômicos para Solana entrar depois sem reimplementar core      | 3     |
| Dashboard proof é cross-chain                             | `qc-dashboard` deve renderizar prova blockchain para qualquer `blockchain.chain`; Stellar Expert é só o link do UAT atual, não filtro de exibição                                                                    | 3     |
| TransferController payload usa buyerDocument+documentType | Plano mencionava toOwner+reason mas a assinatura real do TransferRegistryFacet é buyerDocument+documentType; controller adaptado sem alterar Facet                                                                   | 1     |
| WebhookInbox status DONE/FAILED per schema                | Plano mencionava PROCESSED/APPROVED mas o schema define PENDING/PROCESSING/DONE/FAILED; implementação segue o schema                                                                                                 | 1     |
| CurationFacet não adicionado ao FacetRegistry             | Rota pública direta (não via Diamond) — conforme spec 2026-05-08; decisão arquitetural intencional                                                                                                                   | 1     |
| Tenant isolation via findFirst com {id, tenantId}         | Cross-tenant retorna 404 (NOT_FOUND) em vez de 403 — evita information leakage sobre existência de recursos de outros tenants                                                                                        | 1     |
| Requisitos podem ser transversais                         | Aceite real pode exigir integração entre `qc-backend`, `qc-dashboard`, `qc-home`, `qc-record-module` e decisão de negócio em `qc-business`; planos devem declarar repos impactados e UAT fim a fim                   | —     |
| Admin B2B começa no qc-dashboard                          | A primeira entrega usa módulo admin isolado no `qc-dashboard`; `qc-admin` separado fica condicionado a deploy/auth/compliance/marca/manutenção próprios                                                              | 4     |
| B2B admin operacional antes de identidade/backfill         | Cadastro de empresa, ativação, API keys, compras e créditos precisam existir antes de migrar usuários/assets para o modelo canônico                                                                                  | 4     |
| Créditos são ledger, não wallet custodial do cliente       | Compra/uso/concessão de créditos deve passar por ledger backend; wallet do cliente não é custodiada diretamente pela Quantum Cert                                                                                   | 4     |
| Transfero é candidata para recebimentos                    | Transfero deve ser pesquisada primeiro como anchor/provider de recebimentos; integração final, settlement, moedas e webhooks ficam como implementação a definir com `qc-business`                                  | 4     |
| QTAG tem saldo próprio e fulfillment operacional           | Compra de TAG física gera entitlement/saldo QTAG separado de créditos; uso exige selecionar Asset, cria pedido de emissão e entra na fila admin de gravação/despacho                                                | 4     |
| QTAG ativa somente após commissioning físico               | Compra ou reserva não ativa chip; TAG fica ativa apenas após gravação/commissioning confirmado e sempre vinculada a um Asset                                                                                        | 4     |
| Perfil de tenant como Asset canônico                       | Perfil comercial do tenant é editável no admin e toda criação/alteração mantém um `Asset` `tenant-profile:<tenantId>` com `EventLog` aprovado para ancoragem                                                       | 4     |
| B2C sob Tenant Quantum na Phase 4                         | Usuários consumidores não viram tenants; vivem como usuários tenant-scoped do Tenant Quantum, com dependentes e assets próprios; Tenant Quantum/backfill ficam na Phase 4                                          | 4     |
| B2B permanece tenant real                                 | Clientes B2B precisam de tenant próprio, admins, operadores, API keys, limites, billing e white-label; Phase 5 fica focada nessa prontidão B2B externa                                                             | 5     |
| Backend vira fonte canônica de usuários e domínio         | O banco do dashboard hoje guarda usuários/dependentes, mas a transição de Tenant Quantum/backfill B2C deve ser executada na Phase 4 antes dos boundaries B2B da Phase 5                                             | 4     |
| Asset on-chain para toda entidade                         | Perfil, dependente, pet, objeto, documento e QTAG devem nascer como `Asset` local e receber identidade/proveniência on-chain, em vez de apenas ancorar eventos soltos                                                | 6     |

### Research Flags

| Phase   | Requer research-phase | Motivo                                                                |
| ------- | --------------------- | --------------------------------------------------------------------- |
| Phase 3 | Sim                   | Soroban contract ABI vs SorobanAdapter.ts + BIP-44 migration strategy |
| Phase 4 | Sim                   | Admin cross-repo para tenants, API keys, compras, recebimentos/provider, créditos, saldo/fila QTAG e autorização platform/tenant |
| Phase 5 | Sim                   | Prontidão B2B externa: admins/operators por tenant, API tenant-ready, white-label/public boundary e piloto |
| Phase 6 | Sim                   | Modelo Stellar/Soroban para Asset identity + registry/provenance por entidade |
| Phase 8 | Sim                   | TEAL/Soroban escrow on-chain — smart contract requer auditoria de segurança |

### Blockers

- Phase 2 physical QTAG UAT: `qc-backend` generates production commissioning material and confirms sessions, but full physical acceptance is blocked until the external NFC writer module (`qc-record-module`) is updated from the old `/api/production-queue` and `/api/tag-provisioned` contract to the current Diamond selectors `commissioning.start` and `commissioning.confirm`.

### Todos

- Plan/update `qc-record-module` integration so a real NTAG 424 DNA can be written, locked, scanned, and approved through `/api/v1/scan`.
- Executar a Fase 4 a partir de 7 planos: schema canônico/autorização admin; ciclo de vida de tenant/dashboard shell; API keys/request audit; créditos/recebíveis; QTAG entitlement/fulfillment; Tenant Quantum/backfill/cutover B2C; UAT admin cross-repo.
- Plan Phase 5 around B2B external tenant readiness after Phase 4: tenant admins/operators, tenant API consumption, white-label/public boundaries, B2B pilot and `qc-business` commercial packaging decisions.
- Plan Phase 6 after Phase 5 so on-chain Asset identity uses stable tenant/user/ownership references.
- Before executing a requirement with product/business ambiguity, check whether the decision belongs in `qc-business` and whether acceptance depends on `qc-dashboard`, `qc-home`, or `qc-record-module`.

---

## Session Continuity

**Last session**: 2026-05-09 — Phase 1 aprovada, marcada completa, PR #17 mergeado em `main`. 4/4 plans, 12 requirements (SEC-01..06, CORE-01..06), Nyquist-compliant. Review-fix: 12/15 findings in-scope corrigidos, incluindo todos os 7 Criticals; os 3 avisos restantes foram classificados como dívida técnica não bloqueante, sem impedir o encerramento da fase.

**Phase 1 closure validation**: 2026-05-09 — sem blockers ativos, sem todos pendentes, sem verificação humana pendente. `01-VERIFICATION.md` está `status: passed`, `human_verification: []`; `01-HUMAN-UAT.md` está `status: passed`, `pending: 0`, `blocked: 0`; `01-REVIEW-FIX.md` está `complete_with_non_blocking_deferred_items`, `critical_remaining: 0`, `blocking_remaining: 0`.

**Phase 1 merge**: PR #17 mergeado em `main` em 2026-05-09T04:43:15Z, merge commit `62a12252ca921893641ec7b8c47a9205a5e40306`. Branch remota removida e branch local de trabalho apagada após sincronização.

**Last planning session**: 2026-05-13 — Phase 2 planejada com 3 planos em 3 waves: 02-01 public document verification + bridge idempotency, 02-02 QTAG commissioning with tenant-scoped KMS material, 02-03 suspicious QTAG scan verification/audit. Research, pattern map, and validation strategy created.

**Phase 3 planning session**: 2026-05-13 — Phase 3 planejada com 3 planos em 3 waves: 03-01 Stellar/Soroban provisioning + tenant-safe anchoring, 03-02 public blockchain proof + optional env-gated document payment hook, 03-03 cross-chain dashboard proof card + UAT + scope reconciliation. Em 2026-05-14, REQ-6 foi reclassificado: x402/micropagamento é nice-to-have, não must-have, com direção futura preferida via Anchor/BRZ (ex: Transfero).

**Phase 3 ship**: 2026-05-14 — backend PR #23 (`phase-3-stellar-soroban`) and dashboard PR #23 (`phase-3-dashboard-blockchain-proof`) opened for review. Stellar testnet UAT passed with tx `75f2d84ec135f06a903b91a82484bb6b82267ed002605a5827d54143fc8dd5cc`.

**Phase 3 merge**: 2026-05-16 — backend PR #23 and dashboard PR #23 merged to `main`.

**Next action**: Execute Phase 4 Plan 06 — `.planning/phases/04-b2b-admin-operations-console/04-06-PLAN.md`.

**Context for next session**:

- Branch: `main` atualizada com PR #17 mergeado
- Phase 1 COMPLETA: Falcon-512 real, SKIP LOCKED, Lifecycle, Transfer REST, Curation Layer, review-fix aplicado
- Code review fix report: `.planning/phases/01-core-gap-closure-production-hardening/01-REVIEW-FIX.md` — encerrado sem blocker; WR-01, WR-06, WR-07 postergados como dívida técnica não bloqueante por exigirem mudança cross-cutting/schema
- Phase 2: DOC-01/02/03 + QTAG-01/02 implementados e verificados automaticamente; UAT físico registrado como bloqueado em `.planning/phases/02-document-verification-qtag-production/02-HUMAN-UAT.md` por dependência externa do `qc-record-module`.
- Phase 4 approved 2026-05-17: build isolated admin module inside `qc-dashboard` for B2B company/tenant registration, activation, API keys, purchases, provider-based receivables, credit ledger/grants, QTAG entitlement balance, QTAG fulfillment/engraving/dispatch queue, tenant admin operations and audit; also create Tenant Quantum and execute complete B2C dashboard backfill/cutover. Separate `qc-admin` app is deferred until there is a concrete deploy/auth/compliance/brand need. Transfero is the preferred receivables/anchor candidate to research first, with final implementation to define.
- Phase 5 approved 2026-05-17: focus B2B external tenant readiness after Phase 4, including tenant admins/operators, API consumption, white-label/public boundaries and pilot cutover; B2C Tenant Quantum/backfill is not Phase 5 scope.
- Phase 6 approved 2026-05-17: every profile/dependent/pet/object/document/QTAG must be represented as local Asset plus on-chain Asset/registry proof with event provenance.
- Phase 4 Plan 02 completed 2026-05-17: backend `/api/v1/admin/platform/tenants` lifecycle/profile routes, `AdminTenantOperationsFacet`, admin audit, dashboard `adminRouter`, `QCBackendClient.admin.tenants.*`, and `/admin/platform/tenants` + `/admin/platform/tenants/:tenantId` UI are implemented and verified.
- Fase 4 Plano 03 concluído em 2026-05-17: ciclo de vida admin de API keys no backend, request audit sanitizado, aba API Keys no dashboard, `/admin/platform/audit` e invariante canônico de seed da Quantum Cert foram implementados e verificados. `dev@localhost` resolve como Platform Admin e `Quantum Cert` aparece na listagem admin com slug `quantum-cert-platform`.
- Fase 4 Plano 04 concluído em 2026-05-17: ledger operacional de créditos, boundary genérico de recebíveis, provider fake/local, webhook deduplicado, rotas admin de créditos/pagamentos, aba Credits no Tenant Detail e fila `/admin/platform/queues/payments` foram implementados e verificados. Créditos continuam separados de `UserWallet`; Transfero permanece candidata/TBD.
- Fase 4 Plano 05 concluído em 2026-05-17: ledger QTAG, reserva por Asset, fulfillment order, link de commissioning com `fulfillmentOrderId`, atualização de `Asset.deviceId`, rotas admin QTAG, aba QTAGs e fila `/admin/platform/queues/qtags` foram implementados e verificados.
- Fase 4 atualização cross-cutting em 2026-05-17: aba Perfil do tenant no dashboard ficou editável e o backend passou a manter `Asset` canônico `tenant-profile:<tenantId>` + `EventLog` aprovado com `signatureHash` para cada criação/alteração de perfil comercial.
