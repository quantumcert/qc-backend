# Requirements — Quantum Cert Backend

_Generated: 2026-05-08 | updated 2026-05-17 with B2B admin operations, receivables/credits, QTAG fulfillment, Tenant Quantum/backfill, B2B tenant readiness and on-chain asset identity transition_

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

- [x] **DOC-01**: `GET /api/v1/public/verify/document/{sha3-512-hash}` — endpoint público sem autenticação, lookup por hash
- [x] **DOC-02**: Lookup reverso por `signatureHash` — retorna asset e cadeia de eventos de ancoragem
- [x] **DOC-03**: Response com metadados de ancoragem (txId, chain, timestamp) + info pública do tenant (sem dados sensíveis)

### QTAG — QTAG / NFC Production

- [x] **QTAG-01**: `CommissioningFacet` com KMS production path — NFC commissioning funcional em produção (não só dev)
- [x] **QTAG-02**: `SDMVerifier` integrado com `CommissioningFacet` — verifica autenticidade do QTAG físico

### DLT — Pluggable DLT Workers

- [x] **DLT-01**: Stellar/Soroban adapter — implementa `IDLTAdapter` para ancoragem em Stellar (prioridade hackathon)
- [ ] **DLT-02**: Solana adapter — implementa `IDLTAdapter` para ancoragem em Solana; permanece no backlog v1 e está deferred from Phase 3 hackathon slice
- [x] **DLT-03**: Config `targetChain` por tenant — cada tenant escolhe qual chain usar para ancoragem
- [x] **DLT-04**: Omnibus routing por chain — master wallet opera em cada chain suportada; no slice Stellar/hackathon, o aceite é preservar os seams multi-chain sem implementar todos os adapters
- [ ] **DLT-05**: `lastScannedBlock` persistido em DB — confirmação de transações não depende de estado in-memory (sobrevive restarts); permanece no backlog v1 e está deferred from Phase 3 hackathon slice

### ADMIN — B2B Admin Operations Console

- [ ] **ADMIN-01**: Admin operacional no `qc-dashboard` — criar módulo isolado de admin para Platform Admin Quantum e Tenant Admin B2B, sem criar app `qc-admin` nesta fase
- [ ] **ADMIN-02**: Cadastro de clientes/empresas B2B — Platform Admin cadastra empresa, perfil comercial, contatos, CNPJ/tax ID, plano, limites e status do tenant
- [ ] **ADMIN-03**: Ativação e suspensão de tenants — fluxo auditável para draft, pending review, active, suspended e archived
- [ ] **ADMIN-04**: Gestão de API keys B2B — criar, rotacionar, revogar e auditar chaves por tenant, com secret hasheado, prefixo visível, escopos e expiração
- [ ] **ADMIN-05**: Operações comerciais — registrar compras/pedidos/ativações e expor histórico operacional por tenant
- [ ] **ADMIN-06**: Concessão e ajuste de créditos B2B — Platform Admin concede, revoga ou ajusta créditos com motivo obrigatório e ledger auditável
- [ ] **ADMIN-07**: Gestão de admins e operadores do tenant — convidar/remover Tenant Admins e operadores respeitando escopo do tenant
- [ ] **ADMIN-08**: Auditoria admin server-side — toda mutação privilegiada exige autorização backend e gera evento de auditoria por actor/tenant/ação
- [ ] **ADMIN-09**: Ledger de créditos separado da wallet financeira — créditos de uso da aplicação são conta/ledger comercial, não saldo on-chain nem custódia direta da wallet do cliente
- [ ] **ADMIN-10**: Recebimentos via provider externo — compra de créditos cria pedido/intenção de pagamento e só credita após confirmação de provider; Transfero é candidata preferencial, implementação final a definir
- [ ] **ADMIN-11**: Saldo de QTAGs separado de créditos — compra de TAG física incrementa saldo/entitlement de QTAG disponível, exibido ao cliente sem ativar TAG nem vincular chip físico
- [ ] **ADMIN-12**: Associação obrigatória QTAG→Asset — usuário escolhe um Asset existente para usar uma QTAG; o saldo disponível é reservado/consumido e um pedido de emissão/gravação é criado
- [ ] **ADMIN-13**: Fila operacional de emissão e despacho QTAG — admin acompanha gravação, QA, falha/retry, despacho, tracking e ativação; TAG só ativa após confirmação de gravação/commissioning físico, não na compra

### ID — Tenant Quantum Identity + Backfill

- [ ] **ID-01**: Tenant Quantum canônico — criar/garantir tenant operacional da Quantum para usuários B2C, sem transformar consumidores em tenants
- [ ] **ID-02**: Usuário tenant-scoped no backend — adicionar modelo canônico para usuários, roles, dependentes, perfil, credenciais/identidades externas e vínculo com tenant
- [ ] **ID-03**: Migração do banco do dashboard — migrar `qc-dashboard.users` para o backend preservando `legacyDashboardUserId`, `legacyOpenId`, CPF/email e metadados de dependentes
- [ ] **ID-04**: Ownership forte entre usuários e assets — resolver `Owner.ownerRef` para usuário canônico quando aplicável, mantendo compatibilidade com `ownerRef` legado
- [ ] **ID-05**: Carteira/créditos B2C no backend — mover `creditsBalance`/fluxos de compra/consumo para o backend, preservando a regra "não mexer no saldo, somente no crédito"
- [ ] **ID-06**: Cutover B2C pós-backfill — dashboard passa a ler/escrever usuários, dependentes, carteira e assets B2C via backend; banco local fica no máximo para sessão/preferências temporárias

### B2B — Tenant External Readiness

- [ ] **B2B-01**: Tenant B2B canônico — clientes externos permanecem tenants próprios, separados do Tenant Quantum, com perfil, plano, limites e status operacional
- [ ] **B2B-02**: Identidade e equipe B2B — tenant admins, operadores e membros são usuários tenant-scoped com roles e convites próprios
- [ ] **B2B-03**: API tenant-ready — tenants B2B usam API keys, scopes, auditoria de requisições, rate limits e documentação/SDK de consumo sem depender de acesso interno Quantum
- [ ] **B2B-04**: Área tenant admin B2B — `/admin/tenant` entrega operação própria do tenant, sem acesso cross-tenant, para equipe, API keys, créditos, QTAGs, compras e auditoria
- [ ] **B2B-05**: White-label/public boundary — consulta pública e superfícies white-label por tenant são separadas da administração interna Quantum e preservam isolamento de dados
- [ ] **B2B-06**: Cutover piloto B2B — um tenant B2B real/piloto consegue operar onboarding, API, créditos, QTAG fulfillment e consulta pública com regras comerciais confirmadas em `qc-business`

### OCHAIN — On-chain Asset Identity + Provenance

- [ ] **OCHAIN-01**: Asset Engine obrigatório para toda entidade — perfil, dependente, pet, objeto, documento e QTAG nascem como `Asset` tenant-scoped antes da publicação
- [ ] **OCHAIN-02**: Identidade on-chain por Asset — cada `Asset` recebe identidade Stellar própria com `asset_code + issuer`, registro Soroban de proveniência e zero PII on-chain
- [ ] **OCHAIN-03**: Eventos rastreáveis na chain — lifecycle, ownership, delegação, QTAG, scan, documento e incidente geram eventos on-chain ordenados com hash do payload
- [ ] **OCHAIN-04**: Prova pública unificada — API pública e dashboard exibem app data + timeline local + prova on-chain + links de explorer/contrato em uma visão única
- [ ] **OCHAIN-05**: Backfill on-chain idempotente — assets existentes recebem registro on-chain e eventos mínimos de origem, com relatório de pendências, retries e conflitos
- [ ] **OCHAIN-06**: Proveniência QTAG vinculada ao Asset — QTAG/Device tem identidade de Asset própria e eventos on-chain de vínculo, commissioning, despacho e ativação relacionados ao Asset protegido

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

### FACET — Specialized Domain Facets (Phase 9)

- [ ] **FACET-01**: `ERecycleFacet` — registro de resíduos e emissão de créditos ambientais ancorables em blockchain ([#10](https://github.com/quantumcert/qc-backend/issues/10))
- [ ] **FACET-02**: Transferência Multi-Party — N assinaturas configuráveis obrigatórias antes de processar transferência de ownership ([#15](https://github.com/quantumcert/qc-backend/issues/15))
- [ ] **FACET-03**: Validação biométrica — match biométrico do owner bloqueia transferência não autorizada ([#15](https://github.com/quantumcert/qc-backend/issues/15))
- [ ] **FACET-04**: Geração de Contrato Dinâmico — contrato gerado automaticamente no evento de transferência com dados do asset e das partes ([#15](https://github.com/quantumcert/qc-backend/issues/15))
- [ ] **FACET-05**: Todos os Facets da Fase 9 seguem a Golden Rule — zero termos de domínio no core, payload 100% opaco

---

## Backlog / Deferred Beyond Current Slice

- Triple-sign workflow completo (tenant + Quantum Authority + auditora terceira) — depende de M2M maduro
- Suporte a stablecoins/tokens para pagamento de fees além do Omnibus wallet
- SDK cliente para tenants (wraps `POST /api/v1/diamond`)
- Painel de billing multi-chain por tenant

---

## Out of Scope

- **Frontend/UI dentro do backend** — implementação visual vive em `qc-dashboard`, `qc-home` e `qc-record-module`; porém requisitos podem ser transversais e exigir planejamento/validação nesses repos
- **Lógica de negócio específica de tenant** — plataforma é agnóstica (Golden Rule); customizações ficam no payload opaco
- **Operação de nó blockchain** — usamos nós hospedados (`ALGOD_SERVER`, Stellar Horizon, Solana RPC) — não rodamos nodes próprios
- **Custódia de ativos físicos** — backend certifica, não guarda; responsabilidade do tenant
- **OAuth/magic link como decisão de produto** — auth B2C/B2B entra na fase ID; o método final de login público ainda depende de decisão de produto em `qc-business`

## Cross-Repo Requirement Policy

Quantum Cert é um workspace multi-repo composto por `qc-backend`, `qc-dashboard`, `qc-home`, `qc-record-module` e `qc-business`.

- `qc-business` é a fonte de verdade para decisões de negócio, produto, pricing, monetização e regras comerciais.
- `qc-backend` é a fonte de verdade para contratos de API, segurança, persistência e integrações DLT.
- `qc-dashboard`, `qc-home` e `qc-record-module` são consumidores/implementadores de experiências específicas.
- Um requisito não deve ser marcado como aceito se o fluxo real depender de outro repo ainda não integrado.
- Planos devem declarar os repos impactados, contratos entre eles, ordem de execução e UAT fim a fim quando o requisito for transversal.

---

## Traceability

_Updated: 2026-05-17 — requisitos ADMIN/ID/B2B/OCHAIN adicionados para administrar B2B, recebimentos/créditos, QTAG fulfillment, migrar Tenant Quantum/backfill, preparar tenants B2B externos e garantir Asset on-chain por entidade_

| REQ-ID   | Phase   | Status                          |
| -------- | ------- | ------------------------------- |
| SEC-01   | Phase 1 | Done 2026-05-08                 |
| SEC-02   | Phase 1 | Done 2026-05-08                 |
| SEC-03   | Phase 1 | Done 2026-05-08                 |
| SEC-04   | Phase 1 | Done 2026-05-08                 |
| SEC-05   | Phase 1 | Done 2026-05-08                 |
| SEC-06   | Phase 1 | Done 2026-05-08                 |
| CORE-01  | Phase 1 | Done 2026-05-09                 |
| CORE-02  | Phase 1 | Done 2026-05-09                 |
| CORE-03  | Phase 1 | Done 2026-05-09                 |
| CORE-04  | Phase 1 | Done 2026-05-09                 |
| CORE-05  | Phase 1 | Done 2026-05-09                 |
| CORE-06  | Phase 1 | Done 2026-05-09                 |
| DOC-01   | Phase 2 | Complete                        |
| DOC-02   | Phase 2 | Complete                        |
| DOC-03   | Phase 2 | Complete                        |
| QTAG-01  | Phase 2 | Complete                        |
| QTAG-02  | Phase 2 | Complete                        |
| DLT-01   | Phase 3 | Complete                        |
| DLT-02   | Phase 3 | Deferred from Stellar slice     |
| DLT-03   | Phase 3 | Complete                        |
| DLT-04   | Phase 3 | Complete for Stellar slice      |
| DLT-05   | Phase 3 | Deferred from Stellar slice     |
| ADMIN-01 | Phase 4 | Approved for planning           |
| ADMIN-02 | Phase 4 | Approved for planning           |
| ADMIN-03 | Phase 4 | Approved for planning           |
| ADMIN-04 | Phase 4 | Approved for planning           |
| ADMIN-05 | Phase 4 | Approved for planning           |
| ADMIN-06 | Phase 4 | Approved for planning           |
| ADMIN-07 | Phase 4 | Approved for planning           |
| ADMIN-08 | Phase 4 | Approved for planning           |
| ADMIN-09 | Phase 4 | Approved for planning           |
| ADMIN-10 | Phase 4 | Approved for planning           |
| ADMIN-11 | Phase 4 | Approved for planning           |
| ADMIN-12 | Phase 4 | Approved for planning           |
| ADMIN-13 | Phase 4 | Approved for planning           |
| ID-01    | Phase 4 | Absorbed into Phase 4 by 2026-05-17 user decision |
| ID-02    | Phase 4 | Absorbed into Phase 4 by 2026-05-17 user decision |
| ID-03    | Phase 4 | Absorbed into Phase 4 by 2026-05-17 user decision |
| ID-04    | Phase 4 | Absorbed into Phase 4 by 2026-05-17 user decision |
| ID-05    | Phase 4 | Absorbed into Phase 4 by 2026-05-17 user decision |
| ID-06    | Phase 4 | Absorbed into Phase 4 by 2026-05-17 user decision |
| B2B-01   | Phase 5 | Approved after Tenant Quantum/backfill in Phase 4 |
| B2B-02   | Phase 5 | Approved after Tenant Quantum/backfill in Phase 4 |
| B2B-03   | Phase 5 | Approved after Tenant Quantum/backfill in Phase 4 |
| B2B-04   | Phase 5 | Approved after Tenant Quantum/backfill in Phase 4 |
| B2B-05   | Phase 5 | Approved after Tenant Quantum/backfill in Phase 4 |
| B2B-06   | Phase 5 | Approved after Tenant Quantum/backfill in Phase 4 |
| OCHAIN-01 | Phase 6 | Approved for planning          |
| OCHAIN-02 | Phase 6 | Approved for planning          |
| OCHAIN-03 | Phase 6 | Approved for planning          |
| OCHAIN-04 | Phase 6 | Approved for planning          |
| OCHAIN-05 | Phase 6 | Approved for planning          |
| OCHAIN-06 | Phase 6 | Approved for planning          |
| OPS-01   | Phase 7 | Pending                         |
| OPS-02   | Phase 7 | Pending                         |
| OPS-03   | Phase 7 | Pending                         |
| OPS-04   | Phase 7 | Pending                         |
| OPS-05   | Phase 7 | Pending                         |
| OPS-06   | Phase 7 | Pending                         |
| OPS-07   | Phase 7 | Pending                         |
| ESC-01   | Phase 8 | Pending                         |
| ESC-02   | Phase 8 | Pending                         |
| ESC-03   | Phase 8 | Pending                         |
| ESC-04   | Phase 8 | Pending                         |
| ESC-05   | Phase 8 | Pending                         |
| M2M-01   | Phase 8 | Pending                         |
| M2M-02   | Phase 8 | Pending                         |
| M2M-03   | Phase 8 | Pending                         |
| FACET-01 | Phase 9 | Pending                         |
| FACET-02 | Phase 9 | Pending                         |
| FACET-03 | Phase 9 | Pending                         |
| FACET-04 | Phase 9 | Pending                         |
| FACET-05 | Phase 9 | Pending                         |
