# ROADMAP — Quantum Cert Backend

_Generated: 2026-05-08 | Granularity: standard | Mode: mvp_
_Coverage: 36/36 v1 requirements mapped + Phase 6 (domain facets)_
_GitHub Project: https://github.com/orgs/quantumcert/projects/1_

---

## GitHub Milestone Mapping

| GSD Phase | GitHub Milestone | Issues     |
| --------- | ---------------- | ---------- |
| Phase 1   | Milestone #1     | #5, #7, #8 |
| Phase 2   | Milestone #2     | #12, #2    |
| Phase 3   | Milestone #3     | #11        |
| Phase 4   | Milestone #4     | #13        |
| Phase 5   | Milestone #5     | #3         |
| Phase 6   | Milestone #6     | #10, #15   |

> Each GSD plan within a phase maps to a GitHub Issue (existing or new).
> Branch naming: `{issue-number}-{type}-{description}`
> Cross-repo scope: requisitos podem atravessar `qc-backend`, `qc-dashboard`, `qc-home` e `qc-record-module`; decisões de negócio devem ser tratadas em `qc-business`.

---

## Phases

- [x] **Phase 1: Core Gap Closure + Production Hardening** _(4/4 plans complete)_ — Fechar falhas de segurança críticas e conectar features inacessíveis antes de qualquer expansão
- [ ] **Phase 2: Document Verification + QTAG Production** _(3/3 plans complete; human UAT pending)_ — Verificação pública de documentos e NFC commissioning funcionando em produção
- [ ] **Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority** _(3/3 plans complete; UAT passed; PRs open)_ — Adapter Stellar para hackathon + infraestrutura multi-chain
- [ ] **Phase 4: Scale + Observability Infrastructure** — Redis, Pino, Sentry, BullMQ — plataforma multi-instância pronta para carga real
- [ ] **Phase 5: EscrowFacet + Time-Lock Oracle + M2M** — Escrow on-chain com time-lock e registro de agentes IoT
- [ ] **Phase 6: Specialized Domain Facets** — ERecycleFacet, transferência Multi-Party, biometria, contratos dinâmicos

---

## Phase Details

### Phase 1: Core Gap Closure + Production Hardening

**Goal**: A plataforma opera sem riscos catastróficos — chaves Falcon persistidas, verificação real implementada, circuit breaker seguro, e todas as features existentes alcançáveis via Diamond
**Mode:** mvp
**GitHub Milestone**: [#1](https://github.com/quantumcert/qc-backend/milestone/1)
**GitHub Issues**: [#5](https://github.com/quantumcert/qc-backend/issues/5) (Criptografia centralizada), [#7](https://github.com/quantumcert/qc-backend/issues/7) (Curation Layer — **branch atual**), [#8](https://github.com/quantumcert/qc-backend/issues/8) (Bloqueio transferência + Emancipação)
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06
**Success Criteria** (what must be TRUE):

1. Um restart do servidor não invalida chaves Falcon de nenhum tenant — wallets permanecem acessíveis após reinicialização
2. Um ADMIN não consegue acionar o CircuitBreaker com token inválido — o endpoint rejeita qualquer assinatura Falcon forjada
3. Dois workers executando `AnchorQueueService` simultaneamente não processam o mesmo `EventLog` — distributed lock garante exclusão mútua
4. Um request `POST /api/v1/diamond` com selector `document.verify` retorna resultado (não 404) — `DocumentVerificationFacet` está registrado no `FacetRegistry`
5. Uma transição de estado inválida (ex: `BURNED → ACTIVE`) é rejeitada com 422 — `LifecycleFacet` enforce as regras de estado; contribuições de não-auditores entram em fila `PENDING_REVIEW` e são visíveis para aprovação

**Plans**: 4 plans, 2 waves

**Wave 1** _(paralelos — sem dependências entre si)_

- [x] 01-01-PLAN.md — PQC Security fixes: SEC-01 (KMS fail-fast), SEC-02 (verifySignature real), SEC-03 (CircuitBreaker Falcon-512) — DONE 2026-05-08
- [x] 01-02-PLAN.md — AnchorQueue + Registry: SEC-04 (SKIP LOCKED), SEC-05 (document.verify selector), SEC-06 (tenantId em ChainTransaction) — DONE 2026-05-08
- [x] 01-03-PLAN.md — Core Gaps: CORE-01 (Lifecycle regression), CORE-02 (PATCH /transfer), CORE-03 (Scheduler), CORE-04 (MP webhook + Inbox) — DONE 2026-05-09

**Wave 2** _(bloqueado pela Wave 1 completa)_

- [x] 01-04-PLAN.md — Curation Layer: CORE-05 (PendingContribution) + CORE-06 (review flow) + `[BLOCKING] npx prisma db push` — DONE 2026-05-09

**Cross-cutting constraints:**

- `tenantId` NUNCA do request body — extraído de `secureContext` via `requireApiKey` (todos os planos)
- Golden Rule: zero termos de domínio no core (especialmente Plan 04 — CurationFacet)
- `[BLOCKING]` Prisma schema push + generate obrigatório antes da verification (Plan 04 Task 4)

### Phase 2: Document Verification + QTAG Production

**Goal**: Qualquer pessoa pode verificar a autenticidade de um documento via hash público, e NFC commissioning funciona em produção com KMS real
**Mode:** mvp
**GitHub Milestone**: [#2](https://github.com/quantumcert/qc-backend/milestone/2)
**GitHub Issues**: [#12](https://github.com/quantumcert/qc-backend/issues/12) (Validador público), [#2](https://github.com/quantumcert/qc-backend/issues/2) (Bridge qc-record-module → Diamond)
**Depends on**: Phase 1
**Requirements**: DOC-01, DOC-02, DOC-03, QTAG-01, QTAG-02
**Success Criteria** (what must be TRUE):

1. Um usuário anônimo pode fazer `GET /api/v1/public/verify/document/{sha3-512-hash}` e receber metadados de ancoragem (txId, chain, timestamp) sem precisar de API key
2. O response de verificação pública não expõe dados sensíveis do tenant — apenas campos públicos definidos (nome, chain, txId)
3. Um QTAG físico pode ser comissionado em produção — `CommissioningFacet` usa KMS production path, não dev stub
4. Um QTAG suspeito é rejeitado na verificação — `SDMVerifier` detecta tags não-autênticas e retorna erro de autenticidade

**Plans**: 3 plans, 3 waves
**UI hint**: no

**Wave 1**

- [x] 02-01-PLAN.md — Public document verification + qc-record-module bridge idempotency: DOC-01, DOC-02, DOC-03

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 02-02-PLAN.md — QTAG production commissioning with tenant-scoped KMS material: QTAG-01

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 02-03-PLAN.md — Suspicious QTAG scan verification and audit trail: QTAG-02

**Cross-cutting constraints:**

- Keep canonical public document route as `/api/v1/public/verify/document/{hash}`; do not add `/api/v1/verify/document/{hash}` in this phase.
- Use blocking Prisma schema push tasks after planned schema changes before verification.
- Preserve public QTAG `DENIED` response shape while adding audit logging for identifiable devices.
- Physical QTAG acceptance is cross-repo: backend selectors are not sufficient without `qc-record-module` writing/locking/scanning a real tag.

### Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority

**Goal**: Tenants podem ancorar eventos em Stellar (hackathon) e a infraestrutura multi-chain está pronta para adicionar novas chains sem tocar no core
**Mode:** mvp
**GitHub Milestone**: [#3](https://github.com/quantumcert/qc-backend/milestone/3)
**GitHub Issues**: [#11](https://github.com/quantumcert/qc-backend/issues/11) (related to Soroban/Stellar adapter work; not closed by this phase because `TikinEscrowFacet` and `escrow.*` selectors remain out of scope)
**Depends on**: Phase 1
**Requirements**: DLT-01, DLT-03, DLT-04 seam preservation; DLT-02 and DLT-05 remain v1 backlog/deferred for this Stellar hackathon slice
**Success Criteria** (what must be TRUE):

1. Um tenant com `targetChain: stellar` tem seus `EventLog` records ancorados em Stellar — txId da Stellar gravado em `ChainTransaction`
2. Um tenant com `targetChain: algorand` continua funcionando sem alteração — o adapter Algorand existente não foi modificado
3. Queue, public verification, proof payloads and dashboard display remain chain-agnostic/Solana-ready through `tenant.targetChain`, `IDLTAdapter`, `ChainTransaction.chain` and generic `blockchain` fields
4. Queries por tenant em `ChainTransaction` retornam apenas registros daquele tenant — `tenantId` está persistido na tabela
5. O dashboard renderiza a prova para qualquer `blockchain.chain`; no UAT Stellar, inclui link para Stellar Expert

**Scope note:** This hackathon slice follows `03-SPEC.md`; `DLT-02` Solana and `DLT-05` persisted `lastScannedBlock` are intentionally deferred. Stellar is the execution target now, but queue/proof contracts must remain Solana-ready through `targetChain`, `IDLTAdapter`, and generic `blockchain` fields.

**Execution note:** Backend proof and dashboard rendering are implemented; Stellar testnet UAT passed and evidence is recorded in `03-HUMAN-UAT.md`. Shipping PRs: `qc-backend#23` and `qc-dashboard#23`.

**Plans**: 3 plans, 3 waves
**Cross-repo note:** dashboard proof display belongs to `qc-dashboard` and must render every `blockchain.chain`, not only Stellar; any monetization/pricing decision, including x402/Anchor/BRZ direction, belongs to `qc-business` before it becomes a hard implementation requirement.

**Wave 1**

- [x] 03-01-PLAN.md — Stellar/Soroban provisioning + tenant-safe anchoring

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 03-02-PLAN.md — Public blockchain proof + optional document payment hook

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 03-03-PLAN.md — Cross-chain dashboard proof card + UAT + scope reconciliation

### Phase 4: Scale + Observability Infrastructure

**Goal**: A plataforma opera corretamente em múltiplas instâncias simultâneas com observabilidade de produção completa
**Mode:** mvp
**GitHub Milestone**: [#4](https://github.com/quantumcert/qc-backend/milestone/4)
**GitHub Issues**: [#13](https://github.com/quantumcert/qc-backend/issues/13) (Revisar mensagens de erro/docs)
**Depends on**: Phase 1
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07
**Success Criteria** (what must be TRUE):

1. Duas instâncias do servidor em rolling deploy compartilham o mesmo estado de rate limiting e idempotency — nenhum request passa duas vezes nem é bloqueado incorretamente
2. Todos os logs da plataforma aparecem em formato JSON estruturado com campos `tenantId`, `requestId`, `level` — nenhuma chamada `console.*` permanece
3. Uma exceção não tratada em produção gera um evento Sentry com contexto de tenant e request — diagnóstico sem acesso ao servidor
4. Um job de anchoring que falha é reenfileirado automaticamente pelo BullMQ — sem perda de eventos financeiros por fire-and-forget
5. O endpoint `GET /health` retorna profundidade da fila AnchorQueue e status das DLT connections — operador monitora sem acessar banco diretamente

**Plans**: TBD

### Phase 5: EscrowFacet + Time-Lock Oracle + M2M

**Goal**: Assets podem ser travados em escrow on-chain com liberação automática por tempo, e dispositivos IoT autenticados podem injetar eventos com assinatura Falcon
**Mode:** mvp
**GitHub Milestone**: [#5](https://github.com/quantumcert/qc-backend/milestone/5)
**GitHub Issues**: [#3](https://github.com/quantumcert/qc-backend/issues/3) (AgentRegistryFacet + qc-universal-gateway)
**Depends on**: Phase 3, Phase 4
**Requirements**: ESC-01, ESC-02, ESC-03, ESC-04, ESC-05, M2M-01, M2M-02, M2M-03
**Success Criteria** (what must be TRUE):

1. Um asset em estado `LOCKED_IN_ESCROW` não aceita nenhuma mudança de estado antes do `unlockTimestamp` — todas as tentativas retornam 409
2. Após `unlockTimestamp` expirar, o `EscrowReleaseWorker` libera o asset automaticamente — em rolling deploy com duas instâncias, o mesmo escrow é liberado exatamente uma vez
3. A lógica de liberação do escrow é executada no smart contract on-chain (TEAL) — não off-chain via cron apenas
4. Um dispositivo IoT autenticado pode submeter `POST /api/v1/agent/event` com payload Falcon-512 assinado — payload inválido é rejeitado com 401
5. Um agente não registrado para o tenant não consegue injetar eventos — `AgentRegistryFacet` valida pertencimento antes de processar

**Plans**: TBD

### Phase 6: Specialized Domain Facets

**Goal**: Facets de domínio especializado ampliam a plataforma para casos de uso avançados: créditos ambientais, transferência com múltiplas assinaturas, validação biométrica e geração automática de contratos
**Mode:** mvp
**GitHub Milestone**: [#6](https://github.com/quantumcert/qc-backend/milestone/6)
**GitHub Issues**: [#10](https://github.com/quantumcert/qc-backend/issues/10) (ERecycleFacet — resíduos + créditos ambientais), [#15](https://github.com/quantumcert/qc-backend/issues/15) (Transferência Multi-Party, Biometria, Contrato Dinâmico)
**Depends on**: Phase 5
**Requirements**: FACET-01, FACET-02, FACET-03, FACET-04, FACET-05
**Success Criteria** (what must be TRUE):

1. Um tenant pode registrar resíduos via `ERecycleFacet` e receber créditos ambientais ancorables em blockchain
2. Uma transferência de ownership exige N assinaturas configuráveis antes de ser processada — multi-party enforced pelo Facet
3. Validação biométrica bloqueia transferência sem match do owner cadastrado
4. Um contrato dinâmico é gerado automaticamente no evento de transferência com os dados do asset e das partes
5. Todos os novos Facets seguem a Golden Rule — zero termos de domínio específico no core, payload opaco

**Plans**: TBD

---

## Progress Table

| Phase                                               | GitHub Milestone                                             | Issues     | Plans Complete | Status            | Completed  |
| --------------------------------------------------- | ------------------------------------------------------------ | ---------- | -------------- | ----------------- | ---------- |
| 1. Core Gap Closure + Production Hardening          | [M#1](https://github.com/quantumcert/qc-backend/milestone/1) | #5, #7, #8 | 4/4            | Complete          | 2026-05-09 |
| 2. Document Verification + QTAG Production          | [M#2](https://github.com/quantumcert/qc-backend/milestone/2) | #12, #2    | 3/3            | Human UAT pending | -          |
| 3. Pluggable DLT Workers — Stellar/Soroban Priority | [M#3](https://github.com/quantumcert/qc-backend/milestone/3) | #11        | 3/3            | Shipped for review | 2026-05-14 |
| 4. Scale + Observability Infrastructure             | [M#4](https://github.com/quantumcert/qc-backend/milestone/4) | #13        | 0/?            | Not started       | -          |
| 5. EscrowFacet + Time-Lock Oracle + M2M             | [M#5](https://github.com/quantumcert/qc-backend/milestone/5) | #3         | 0/?            | Not started       | -          |
| 6. Specialized Domain Facets                        | [M#6](https://github.com/quantumcert/qc-backend/milestone/6) | #10, #15   | 0/?            | Not started       | -          |
