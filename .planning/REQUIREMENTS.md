# Requirements — Quantum Cert Backend
_Generated: 2026-05-08 | v1 scope: backend completo production-ready (6 sub-sistemas)_

---

## v1 Requirements

### SEC — Security & Production Hardening

- [x] **SEC-01**: Chave Falcon-512 persistida em KMS/secret vault — não gerada como env var efêmera a cada restart _(done: KMSService.getOrCreateFalconKeyPair persiste no DB — 2026-05-08)_
- [x] **SEC-02**: `QuantumSignerService.verifySignature()` implementa verificação criptográfica real (remove stub `return true`) _(done: verifySignatureFalcon512 real via falcon-crypto — 2026-05-08)_
- [x] **SEC-03**: CircuitBreaker com RBAC correto — somente roles autorizadas podem acionar pausa global _(done: Falcon-512 signature validation + CIRCUIT_BREAKER_ADMIN_PUBKEY — 2026-05-08)_
- [x] **SEC-04**: `AnchorQueueService` usa distributed lock (`pg_advisory_lock` ou UUID por worker) para evitar duplo-processamento do mesmo `EventLog` _(done: SELECT FOR UPDATE SKIP LOCKED em $transaction — 2026-05-08)_
- [x] **SEC-05**: `DocumentVerificationFacet` registrado no `FacetRegistry` (atualmente implementado mas unreachable via Diamond) _(done: selector document.verify registrado + interface harmonizada — 2026-05-08)_
- [x] **SEC-06**: `tenantId` persistido em `ChainTransaction` para queries cross-chain e billing por tenant _(done: AlgorandAnchorFacet.anchorEvent() cria ChainTransaction com tenantId do EventLog — 2026-05-08)_

### CORE — Core Gap Closure

- [x] **CORE-01**: `LifecycleFacet` — enforce state transitions: `DRAFT → ACTIVE → SUSPENDED → ARCHIVED`, `ACTIVE → BURNED`, `ACTIVE → AWAITING_PAYMENT`, `AWAITING_PAYMENT → ACTIVE` — DONE 2026-05-09
- [x] **CORE-02**: `TransferRegistryFacet` — `PATCH /api/v1/assets/:assetId/transfer` REST wrapper criado com middleware chain completo — DONE 2026-05-09
- [x] **CORE-03**: `SchedulerService` — node-cron trigger ativo no server.ts startup + WebhookInbox cron job adicionado — DONE 2026-05-09
- [x] **CORE-04**: MercadoPago webhook — HMAC validado + WebhookInbox processor + `MP_WEBHOOK_SECRET` obrigatório em produção — DONE 2026-05-09
- [x] **CORE-05**: Curation Layer — contribuições submetidas por não-auditores entram em fila pendente de aprovação (`PENDING_APPROVAL` status) — DONE 2026-05-09
- [x] **CORE-06**: Fluxo de aprovação — OPERATOR/ADMIN aprovam/rejeitam contribuições pendentes com registro em `EventLog` + AnchorQueue fire-and-forget — DONE 2026-05-09

### DOC — Document Verification (Público)

- [x] **DOC-01**: `GET /api/v1/verify/document/{sha3-512-hash}` — endpoint público sem autenticação, lookup por hash
- [x] **DOC-02**: Lookup reverso por `signatureHash` — retorna asset e cadeia de eventos de ancoragem
- [x] **DOC-03**: Response com metadados de ancoragem (txId, chain, timestamp) + info pública do tenant (sem dados sensíveis)

### QTAG — QTAG / NFC Production

- [x] **QTAG-01**: `CommissioningFacet` com KMS production path — NFC commissioning funcional em produção (não só dev)
- [x] **QTAG-02**: `SDMVerifier` integrado com `CommissioningFacet` — verifica autenticidade do QTAG físico

### DLT — Pluggable DLT Workers

- [ ] **DLT-01**: Stellar/Soroban adapter — implementa `IDLTAdapter` para ancoragem em Stellar (prioridade hackathon)
- [ ] **DLT-02**: Solana adapter — implementa `IDLTAdapter` para ancoragem em Solana
- [ ] **DLT-03**: Config `targetChain` por tenant — cada tenant escolhe qual chain usar para ancoragem
- [ ] **DLT-04**: Omnibus routing por chain — master wallet opera em cada chain suportada
- [ ] **DLT-05**: `lastScannedBlock` persistido em DB — confirmação de transações não depende de estado in-memory (sobrevive restarts)

### OPS — Scale & Observability

- [ ] **OPS-01**: Redis para rate limiting — substitui implementação in-memory (que quebra em rolling deploy multi-instância)
- [ ] **OPS-02**: Redis para idempotency store — substitui in-memory (mesmo motivo)
- [ ] **OPS-03**: Pino logger — substitui 205+ chamadas `console.*` por logging estruturado
- [ ] **OPS-04**: Sentry error tracking — captura exceções em produção com contexto de tenant/request
- [ ] **OPS-05**: BullMQ para workers financeiros — jobs de escrow e anchoring com garantia de entrega (não fire-and-forget)
- [ ] **OPS-06**: Deploy Dokploy-compatible — todos os novos serviços e crons configurados para o ambiente Dokploy existente
- [ ] **OPS-07**: Health monitoring do AnchorQueue — alertas para DLT tx failures e queue depth excessivo

### ESC — EscrowFacet + Time-Lock Oracle

- [ ] **ESC-01**: Estado `LOCKED_IN_ESCROW` no ciclo de vida — asset não pode mudar de estado enquanto em escrow
- [ ] **ESC-02**: `unlockTimestamp` no schema de ativos — define quando o escrow expira
- [ ] **ESC-03**: `EscrowReleaseWorker` cron com `pg_try_advisory_lock` — sem lock, rolling deploy libera o mesmo escrow múltiplas vezes (irreversível on-chain)
- [ ] **ESC-04**: TEAL escrow on-chain real — lógica de liberação executada no smart contract, não off-chain
- [ ] **ESC-05**: Multi-sig com Quantum Authority — liberação requer assinatura de pelo menos 2 partes

### M2M — M2M / Agent Registry

- [ ] **M2M-01**: `AgentRegistryFacet` — registro e gerenciamento de agentes IoT/robôs por tenant
- [ ] **M2M-02**: `POST /api/v1/agent/event` — endpoint dedicado para ingestão de eventos de dispositivos M2M
- [ ] **M2M-03**: Validação de assinatura Falcon-512 no payload do agente — garante autenticidade do dispositivo

### FACET — Specialized Domain Facets (Phase 6)

- [ ] **FACET-01**: `ERecycleFacet` — registro de resíduos e emissão de créditos ambientais ancorables em blockchain ([#10](https://github.com/quantumcert/qc-backend/issues/10))
- [ ] **FACET-02**: Transferência Multi-Party — N assinaturas configuráveis obrigatórias antes de processar transferência de ownership ([#15](https://github.com/quantumcert/qc-backend/issues/15))
- [ ] **FACET-03**: Validação biométrica — match biométrico do owner bloqueia transferência não autorizada ([#15](https://github.com/quantumcert/qc-backend/issues/15))
- [ ] **FACET-04**: Geração de Contrato Dinâmico — contrato gerado automaticamente no evento de transferência com dados do asset e das partes ([#15](https://github.com/quantumcert/qc-backend/issues/15))
- [ ] **FACET-05**: Todos os Facets da Fase 6 seguem a Golden Rule — zero termos de domínio no core, payload 100% opaco

---

## v2 Requirements (Deferred)

- Triple-sign workflow completo (tenant + Quantum Authority + auditora terceira) — depende de M2M maduro
- Solana adapter — pode ser entregue após hackathon Stellar sem impacto no prazo
- Suporte a stablecoins/tokens para pagamento de fees além do Omnibus wallet
- SDK cliente para tenants (wraps `POST /api/v1/diamond`)
- Painel de billing multi-chain por tenant

---

## Out of Scope

- **Frontend/UI** — responsabilidade de `qc-dashboard`, `qc-home`, `qc-record-module`, `qc-tag-emulator`
- **Lógica de negócio específica de tenant** — plataforma é agnóstica (Golden Rule); customizações ficam no payload opaco
- **Operação de nó blockchain** — usamos nós hospedados (`ALGOD_SERVER`, Stellar Horizon, Solana RPC) — não rodamos nodes próprios
- **Custódia de ativos físicos** — backend certifica, não guarda; responsabilidade do tenant
- **Autenticação OAuth/magic link** — API keys são o único mecanismo de auth para o backend

---

## Traceability

_Updated: 2026-05-08 — ROADMAP.md created (gsd-new-project, brownfield)_

| REQ-ID | Phase | Status |
|--------|-------|--------|
| SEC-01 | Phase 1 | Done 2026-05-08 |
| SEC-02 | Phase 1 | Done 2026-05-08 |
| SEC-03 | Phase 1 | Done 2026-05-08 |
| SEC-04 | Phase 1 | Done 2026-05-08 |
| SEC-05 | Phase 1 | Done 2026-05-08 |
| SEC-06 | Phase 1 | Done 2026-05-08 |
| CORE-01 | Phase 1 | Done 2026-05-09 |
| CORE-02 | Phase 1 | Done 2026-05-09 |
| CORE-03 | Phase 1 | Done 2026-05-09 |
| CORE-04 | Phase 1 | Done 2026-05-09 |
| CORE-05 | Phase 1 | Done 2026-05-09 |
| CORE-06 | Phase 1 | Done 2026-05-09 |
| DOC-01 | Phase 2 | Complete |
| DOC-02 | Phase 2 | Complete |
| DOC-03 | Phase 2 | Complete |
| QTAG-01 | Phase 2 | Complete |
| QTAG-02 | Phase 2 | Complete |
| DLT-01 | Phase 3 | Pending |
| DLT-02 | Phase 3 | Pending |
| DLT-03 | Phase 3 | Pending |
| DLT-04 | Phase 3 | Pending |
| DLT-05 | Phase 3 | Pending |
| OPS-01 | Phase 4 | Pending |
| OPS-02 | Phase 4 | Pending |
| OPS-03 | Phase 4 | Pending |
| OPS-04 | Phase 4 | Pending |
| OPS-05 | Phase 4 | Pending |
| OPS-06 | Phase 4 | Pending |
| OPS-07 | Phase 4 | Pending |
| ESC-01 | Phase 5 | Pending |
| ESC-02 | Phase 5 | Pending |
| ESC-03 | Phase 5 | Pending |
| ESC-04 | Phase 5 | Pending |
| ESC-05 | Phase 5 | Pending |
| M2M-01 | Phase 5 | Pending |
| M2M-02 | Phase 5 | Pending |
| M2M-03 | Phase 5 | Pending |
| FACET-01 | Phase 6 | Pending |
| FACET-02 | Phase 6 | Pending |
| FACET-03 | Phase 6 | Pending |
| FACET-04 | Phase 6 | Pending |
| FACET-05 | Phase 6 | Pending |
