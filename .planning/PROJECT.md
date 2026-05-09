# Quantum Cert Backend

## What This Is

Backend da plataforma Quantum Cert — uma API multi-tenant que certifica ativos físicos e digitais via ancoragem em blockchain com criptografia pós-quântica (Falcon-512). Serve dois perfis de tenant: marcas e empresas que certificam produtos físicos contra falsificação, e auditores/certificadoras que emitem certificados de conformidade. A plataforma é construída sobre o padrão Diamond (EIP-2535 adaptado para Node.js), garantindo extensibilidade por Facets sem acoplamento de domínio.

## Core Value

Tríade indivisível: ancoragem DLT com assinatura pós-quântica + ciclo de vida completo de ativos rastreável + plataforma white-label multi-tenant. Nenhum dos três funciona sem os outros — a ausência de qualquer vértice destrói a proposta de valor.

## Requirements

### Validated

— Capacidades existentes no codebase (confirmadas pelo mapeamento de 2026-05-08):

- ✓ Diamond proxy routing (`POST /api/v1/diamond` + `FacetRegistry`) — existing
- ✓ API key authentication (`X-API-Key`, bcrypt hash, prefixo `qc_`) — existing
- ✓ RBAC multi-nível (`ADMIN > OPERATOR > READER`) — existing
- ✓ Tenant isolation via `secureContext` (injetado por middleware, nunca do payload) — existing
- ✓ IP rate limiting (in-memory, nível de servidor) — existing
- ✓ Per-plan rate limiting (Postgres-backed, `RateLimiterFacet`) — existing
- ✓ Idempotency middleware (`X-Idempotency-Key` em mutations) — existing
- ✓ Algorand anchoring (`AlgorandAnchorFacet`, implementa `IDLTAdapter`) — existing
- ✓ Post-quantum signing (Falcon-512 embarcado no note field do txn Algorand) — existing
- ✓ `AnchorQueueService` (FIFO, row lock atômico, batch de 10) — existing
- ✓ Asset CRUD + metadata opaco (hash SHA3-512, sem interpretação no core) — existing
- ✓ `EventLog` (rastreamento de todos os eventos por tenant) — existing
- ✓ Verificação pública de documentos (`GET /api/v1/verify/document`) — existing
- ✓ Documentação OpenAPI via Scalar — existing
- ✓ Omnibus wallet (master wallet `ALGORAND_MASTER_MNEMONIC` assume custódia sem Web3 wallet) — existing

### Active

— Sub-sistemas a implementar para o backend production-ready:

**Sub-sistema 1: Core Gap Closure**
- [ ] `LifecycleFacet` — enforce state transitions (`DRAFT → ACTIVE → SUSPENDED → ARCHIVED → BURNED`)
- [ ] `TransferRegistryFacet` — `PATCH /api/v1/assets/:id/lifecycle` (REST semântico)
- [ ] MercadoPago webhook — `POST /api/v1/webhooks/mercadopago`, sem apiKeyAuth, própria validação de assinatura
- [ ] `SchedulerService` — node-cron trigger para `AnchorQueueService`
- [ ] Curation Layer (issue #7) — contribuições de não-auditores vão para fila pendente de aprovação

**Sub-sistema 2: Document Verification Público**
- [ ] `GET /api/v1/verify/document/{sha3-512-hash}` — lookup reverso por `signatureHash`
- [ ] Endpoint público, sem autenticação
- [ ] Response com metadados de ancoragem + tenant info público

**Sub-sistema 3: Pluggable DLT Workers**
- [ ] Soroban/Stellar adapter (prioridade — hackathon em andamento)
- [ ] Solana adapter
- [ ] Config `targetChain` por tenant
- [ ] Omnibus routing por chain

**Sub-sistema 4: M2M / Agent Registry**
- [ ] `AgentRegistryFacet` — registro de agentes IoT/robôs por tenant
- [ ] `POST /api/v1/agent/event` — ingestão de eventos de dispositivos
- [ ] Validação de assinatura Falcon-512 no payload

**Sub-sistema 5: EscrowFacet + Time-Lock Oracle**
- [ ] Estado `LOCKED_IN_ESCROW` no ciclo de vida
- [ ] `unlockTimestamp` na tabela de ativos
- [ ] `EscrowReleaseWorker` cron
- [ ] Multi-sig com Quantum Authority

**Infra & Ops**
- [ ] Deploy automático Dokploy-compatible para todos os serviços/crons
- [ ] Monitoramento de produção (AnchorQueue health, DLT tx failures)
- [ ] Testes E2E cobrindo todos os sub-sistemas

### Out of Scope

- Frontend/UI — responsabilidade dos repos `qc-dashboard`, `qc-home`, `qc-record-module`
- Lógica de negócio específica de qualquer tenant — plataforma é agnóstica (Golden Rule)
- Operação de nó blockchain — usamos nós hospedados via `ALGOD_SERVER` e equivalentes
- Custódia de ativos físicos — backend só certifica, não guarda

## Context

**Arquitetura:**
Node.js + TypeScript adaptando EIP-2535 Diamond Standard. `DiamondProxy` roteia `POST /api/v1/diamond` por string selector para Facets registrados no `FacetRegistry`. Facets são classes de serviço puras, sem dependências de Express — recebem `secureContext` primeiro, `payload` segundo.

**Golden Rule (imutável):**
Todos os Facets devem ser 100% agnósticos de domínio. Somente termos universais: `Tenant`, `Asset`, `Device`, `Event`, `Owner`, `Metadata`. O campo `payload` em `EventLog` e `Asset.metadata` são blobs JSON opacos — o core nunca interpreta, só valida hash via SHA3-512.

**Ecossistema multi-repo:**
`qc-backend` é o motor da plataforma. Consome: `qc-dashboard` (painel de administração), `qc-home` (site público), `qc-record-module` (módulo de registro), `qc-tag-emulator` (emulador de QTAGs). Planejamento de produto centralizado em `qc-business`.

**Patente INPI:**
Documento depositado descreve QRNG, NFC/RFID, OP_RETURN, Merkle tree, dual-sig transfer. Implementações devem alinhar com o documento — não contradizer nem antecipar claims não depositados.

**Hackathon Stellar:**
Em andamento. Soroban adapter é dependência do hackathon — prioridade máxima entre os DLT Workers.

## Constraints

- **Patente INPI**: Implementações técnicas devem alinhar com o documento depositado. Qualquer claim novo requer consulta antes de implementar.
- **Dokploy**: Toda nova infra (serviços, cron jobs, workers) deve ser compatível com o deploy atual em Dokploy.
- **Hackathon Stellar**: Deadline do Soroban adapter sobrepõe outros DLT Workers em prioridade.
- **Golden Rule (arch)**: Facets NUNCA usam termos de domínio específico. Violações quebram a garantia de neutralidade da plataforma.
- **Tenant isolation**: Queries Prisma SEMPRE escopadas por `tenantId`. Cross-tenant access é impossível no nível de query.

## Key Decisions

| Decisão | Rationale | Outcome |
|---------|-----------|---------|
| EIP-2535 Diamond Pattern (Node.js) | Extensibilidade sem acoplamento entre sub-sistemas — novos Facets não tocam existentes | — Pending |
| `IDLTAdapter` interface única | Chain-agnostic: novas chains são novos adapters, zero mudança no `AnchorQueueService` ou Facets | — Pending |
| Omnibus wallet (master custody) | Tenants sem Web3 wallet podem usar a plataforma — master wallet paga fees | — Pending |
| Hybrid routing (Option C) | Diamond para mutations autenticadas, REST semântico para state changes, webhooks dedicados | — Pending |
| Falcon-512 no note field | PQC signature embarcada no txn — não requer smart contract, funciona em qualquer chain com campo de nota | — Pending |
| Tenant isolation via secureContext | Context injetado por middleware, nunca do payload — cross-tenant impossível no query level | ✓ Good |
| Estrutura de planejamento híbrida | qc-business = visão de produto org. Cada repo tem .planning/ de execução. gsd-workspace para cross-repo. | — Pending |

## Evolution

Este documento evolui em transições de fase e boundaries de milestone.

**Após cada transição de fase** (via `/gsd-transition`):
1. Requirements invalidados? → Mover para Out of Scope com motivo
2. Requirements validados? → Mover para Validated com referência da fase
3. Novos requirements emergiram? → Adicionar em Active
4. Decisões a registrar? → Adicionar em Key Decisions
5. "What This Is" ainda preciso? → Atualizar se drifted

**Após cada milestone** (via `/gsd-complete-milestone`):
1. Revisão completa de todas as seções
2. Core Value check — ainda é a prioridade certa?
3. Auditoria de Out of Scope — motivos ainda válidos?
4. Atualizar Context com estado atual

---
*Last updated: 2026-05-08 após inicialização (gsd-new-project, brownfield)*
