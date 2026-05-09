# Requirements — Quantum Cert Backend
_Generated: 2026-05-08 | v1 scope: backend completo production-ready (6 sub-sistemas)_

---

## v1 Requirements

### SEC — Security & Production Hardening

- [ ] **SEC-01**: Chave Falcon-512 persistida em KMS/secret vault — não gerada como env var efêmera a cada restart
- [ ] **SEC-02**: `QuantumSignerService.verifySignature()` implementa verificação criptográfica real (remove stub `return true`)
- [ ] **SEC-03**: CircuitBreaker com RBAC correto — somente roles autorizadas podem acionar pausa global
- [ ] **SEC-04**: `AnchorQueueService` usa distributed lock (`pg_advisory_lock` ou UUID por worker) para evitar duplo-processamento do mesmo `EventLog`
- [ ] **SEC-05**: `DocumentVerificationFacet` registrado no `FacetRegistry` (atualmente implementado mas unreachable via Diamond)
- [ ] **SEC-06**: `tenantId` persistido em `ChainTransaction` para queries cross-chain e billing por tenant

### CORE — Core Gap Closure

- [ ] **CORE-01**: `LifecycleFacet` — enforce state transitions: `DRAFT → ACTIVE → SUSPENDED → ARCHIVED`, `ACTIVE → BURNED`, `ACTIVE → AWAITING_PAYMENT`, `AWAITING_PAYMENT → ACTIVE`
- [ ] **CORE-02**: `TransferRegistryFacet` — `PATCH /api/v1/assets/:id/lifecycle` REST semântico para mudanças de estado
- [ ] **CORE-03**: `SchedulerService` — node-cron trigger para `AnchorQueueService` (hoje só roda se chamado manualmente)
- [ ] **CORE-04**: MercadoPago webhook — `POST /api/v1/webhooks/mercadopago` com validação de assinatura própria, sem `apiKeyAuth`
- [ ] **CORE-05**: Curation Layer — contribuições submetidas por não-auditores entram em fila pendente de aprovação (`PENDING_REVIEW` status)
- [ ] **CORE-06**: Fluxo de aprovação — auditors com role `OPERATOR` ou `ADMIN` podem aprovar/rejeitar contribuições pendentes, com registro em `EventLog`

### DOC — Document Verification (Público)

- [ ] **DOC-01**: `GET /api/v1/verify/document/{sha3-512-hash}` — endpoint público sem autenticação, lookup por hash
- [ ] **DOC-02**: Lookup reverso por `signatureHash` — retorna asset e cadeia de eventos de ancoragem
- [ ] **DOC-03**: Response com metadados de ancoragem (txId, chain, timestamp) + info pública do tenant (sem dados sensíveis)

### QTAG — QTAG / NFC Production

- [ ] **QTAG-01**: `CommissioningFacet` com KMS production path — NFC commissioning funcional em produção (não só dev)
- [ ] **QTAG-02**: `SDMVerifier` integrado com `CommissioningFacet` — verifica autenticidade do QTAG físico

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
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 1 | Pending |
| SEC-04 | Phase 1 | Pending |
| SEC-05 | Phase 1 | Pending |
| SEC-06 | Phase 1 | Pending |
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| CORE-06 | Phase 1 | Pending |
| DOC-01 | Phase 2 | Pending |
| DOC-02 | Phase 2 | Pending |
| DOC-03 | Phase 2 | Pending |
| QTAG-01 | Phase 2 | Pending |
| QTAG-02 | Phase 2 | Pending |
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
