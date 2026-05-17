# Phase 4: B2B Admin Operations Console - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning; Phase 4 includes Tenant Quantum/backfill and Phase 5 is reserved for B2B external readiness

<domain>
## Phase Boundary

Esta fase entrega o cockpit operacional B2B da Quantum Cert dentro do `qc-dashboard`, suportado por contratos e modelos canonicos no `qc-backend`. O admin deve permitir cadastrar e ativar tenants B2B, emitir e auditar API keys, operar compras/recebimentos/creditos, acompanhar uso por tenant, gerenciar saldos e filas QTAG, e preparar/executar a transicao de dados necessaria para que a Quantum e futuros tenants usem uma fonte unica de visibilidade operacional.

O modulo nasce dentro do `qc-dashboard`, mas deve ser desenhado como boundary separavel para uma futura aplicacao `qc-admin` se deploy, SSO, compliance, marca ou escala operacional justificarem a extracao.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

Os requisitos estao travados em `04-SPEC.md`, `REQUIREMENTS.md` (`ADMIN-01` a `ADMIN-13`) e nos criterios de aceite da fase. Downstream agents MUST read `04-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- modulo admin isolado dentro do `qc-dashboard`, com `/admin/platform` e `/admin/tenant`;
- cadastro, edicao, ativacao, suspensao e arquivamento de tenants/clientes B2B;
- perfil comercial, contatos, plano, limites, white-label metadata e status operacional do tenant;
- emissao, rotacao, revogacao e auditoria de API keys;
- compras, pedidos, payment intents/events e boundary de provider de recebimentos;
- ledger de creditos B2B separado de wallet financeira;
- ledger de entitlement QTAG separado de creditos;
- pedido/fila de fulfillment QTAG vinculado a um `Asset`;
- autorizacao server-side e audit log para mutacoes privilegiadas;
- visoes de Platform Admin Quantum e Tenant Admin B2B.

**Out of scope (from SPEC.md):**
- construir um app `qc-admin` separado nesta fase;
- integracao completa de invoicing/accounting;
- signup B2B publico self-service sem revisao da plataforma;
- UI publica final white-label de verificacao;
- identidade/proveniencia on-chain final de assets;
- contrato final de integracao Transfero/provider, que segue como implementacao a definir com `qc-business`.

</spec_lock>

<decisions>
## Implementation Decisions

### Admin Model, Activation and API Keys
- **D-01:** O modelo inicial e "Quantum forte": Platform Admin Quantum controla cadastro, ativacao, suspensao, concessoes criticas, API keys e auditoria cross-tenant. Tenant Admin opera apenas dentro do proprio tenant.
- **D-02:** O fluxo padrao de novo cliente B2B e manual aprovado: Quantum cria ou revisa o tenant, aprova plano/contrato/comercial e so entao libera operacao e chaves.
- **D-03:** A primeira API key de um tenant deve ser emitida por Platform Admin Quantum, nao por self-service do tenant.
- **D-04:** O admin deve listar API keys ativas por tenant, exibir apenas prefixo/metadados, permitir auditoria de rotacao/revogacao e nunca reexibir segredo apos criacao.
- **D-05:** O admin deve auditar requisicoes feitas por tenants via API key, vinculando tenant, key fingerprint/prefixo, endpoint/selector, status, latencia, correlation id e erro sanitizado, sem gravar segredo nem payload sensivel.

### Commercial Credits, Receivables and Provider Boundary
- **D-06:** O modelo de creditos deve ser um ledger operacional auditavel como fonte de verdade, com entradas como `PURCHASED`, `GRANTED`, `ADJUSTED`, `RESERVED`, `CONSUMED`, `RELEASED`, `REFUNDED` e `REVOKED`.
- **D-07:** Pode existir uma camada tokenizada/on-chain futura para espelhamento, liquidacao ou prova, mas ela nao substitui o ledger interno nesta fase e nao implica custodia direta da wallet do cliente.
- **D-08:** A fase deve criar um boundary generico `PaymentProvider`/`ReceivablesProvider`, com `PaymentIntent` e `PaymentEvent`, deixando Transfero como candidata preferencial TBD para pesquisa/implementacao com `qc-business`.
- **D-09:** Operacoes que consomem creditos devem reservar credito no inicio e liberar em falha/cancelamento; o consumo definitivo so acontece quando a operacao principal for confirmada com sucesso.
- **D-10:** Concessoes, ajustes, revogacoes e estornos manuais feitos por Platform Admin devem usar o mesmo ledger, sempre com actor, motivo obrigatorio, tenant/user scope e audit event.

### QTAG Entitlement and Fulfillment
- **D-11:** QTAG fisica tem saldo/entitlement proprio, separado de creditos de uso da aplicacao.
- **D-12:** Comprar QTAG aumenta saldo disponivel; o chip nao e ativado e nenhum vinculo fisico final e criado no momento da compra.
- **D-13:** Quando o usuario escolhe um `Asset` existente para usar uma QTAG, uma unidade deve ser reservada, um `QTagFulfillmentOrder` deve ser criado e a fila operacional deve receber o trabalho de emissao/grave/QA/despacho.
- **D-14:** A ativacao definitiva da QTAG so ocorre apos gravacao fisica e `commissioning.confirm(success=true)` ou evento operacional equivalente definido no plano.
- **D-15:** Falha ou cancelamento antes da ativacao fisica deve liberar a unidade reservada por entrada auditavel no QTAG ledger; falhas depois da ativacao exigem fluxo operacional especifico, nao ajuste silencioso de saldo.

### Admin UX and Operational Queues
- **D-16:** A tela de detalhe do tenant deve ser o hub central, com abas/painel para status/plano, perfil comercial, usuarios/equipe, API keys, creditos, compras/recebimentos, QTAGs, requisicoes e auditoria.
- **D-17:** Filas operacionais separadas devem existir para ativacoes, pagamentos/recebimentos e QTAG fulfillment, para que operadores Quantum consigam tratar pendencias sem navegar tenant por tenant.
- **D-18:** A interface deve deixar claro o escopo de cada ator: Platform Admin ve e opera cross-tenant; Tenant Admin ve somente dados do proprio tenant.

### Tenant Quantum and Backfill
- **D-19:** O usuario escolheu executar o backfill completo nesta fase (`10B`), nao apenas dry-run. Isso altera a fronteira anterior em que Phase 5 era a fase principal de identity/data backfill.
- **D-20:** O planejamento da Phase 4 deve incluir criacao/garantia do Tenant Quantum, migracao/associacao dos usuarios B2C existentes ao Tenant Quantum, associacao de assets/dependentes/pets/objetos/creditos/saldos QTAG aos tenants corretos e verificacao pos-migracao.
- **D-21:** Phase 4 absorve Tenant Quantum, backfill completo e cutover B2C; Phase 5 fica reservada para prontidao B2B externa (admins/operators por tenant, API tenant-ready, white-label/public boundary e piloto B2B).
- **D-22:** O backfill deve ser auditable e reversivel no nivel operacional: dry-run, relatorio de diffs, execucao idempotente, checkpoints, contagem de registros por origem/destino e trilha de auditoria por lote.

### the agent's Discretion
- Definir nomes finais de tabelas, facets, rotas e componentes seguindo os padroes existentes do `qc-backend` e `qc-dashboard`.
- Definir a granularidade exata de scopes de API key e limites por plano durante planejamento, desde que respeite o controle forte por Platform Admin.
- Definir a estrategia tecnica de volume/retencao para API request audit logs sem gravar secrets ou payload sensivel.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Requirements
- `.planning/phases/04-b2b-admin-operations-console/04-SPEC.md` - requisitos travados, boundaries, criterios de aceite, modelo admin/creditos/QTAG.
- `.planning/ROADMAP.md` - fase 4, dependencia da fase 3, relacao com fase 5 e notas cross-repo.
- `.planning/REQUIREMENTS.md` - requisitos `ADMIN-01` a `ADMIN-13` e `ID-01` a `ID-06` absorvidos na Phase 4.
- `.planning/STATE.md` - decisoes atuais do milestone e proxima acao.
- `.planning/PROJECT.md` - regra de modelo canonico domain-agnostic e separacao de responsabilidades entre repos.

### Prior Phase Decisions
- `.planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-CONTEXT.md` - decisoes de DLT pluggable, Stellar/Soroban, provider/Transfero como direcao comercial futura e separacao `qc-business`.
- `.planning/phases/02-document-verification-qtag-production/02-CONTEXT.md` - decisoes de commissioning QTAG, `qc-record-module`, KMS e ativacao fisica.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` - Diamond/facets, `secureContext`, tenant scoping, DLT adapters, request flow e event anchoring.
- `.planning/codebase/STRUCTURE.md` - onde adicionar facets, routes, controllers, Prisma models e workers.
- `.planning/codebase/INTEGRATIONS.md` - MercadoPago atual, webhooks, Stellar/Soroban, wallets custodiais atuais e lacunas de observabilidade.

### Cross-Repo Anchors
- `../qc-dashboard/server/_core/trpc.ts` - `adminProcedure` existente; admin nao pode ser apenas UI escondida.
- `../qc-dashboard/server/routers.ts` - rotas tRPC existentes para wallet, asset, commissioning e integracao com backend.
- `../qc-dashboard/server/services/qcBackendClient.ts` - client atual para selectors Diamond e chamadas backend.
- `../qc-dashboard/server/wallet.credits.test.ts` - regra ja validada de alterar `creditsBalance`, nao `balance`.
- `../qc-dashboard/client/src/pages/Store.tsx` - loja atual ja modela QTAG/pacotes, mas checkout fisico ainda precisa virar fluxo operacional real.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/core-facets/TenantManagementFacet.ts`: base para CRUD/ativacao de tenant, mas precisa evoluir para status operacional, perfil comercial, limites e auditoria admin.
- `src/services/core-facets/ApiKeyManagementFacet.ts`: base de API key com hash/validacao/rotacao/revogacao; Phase 4 precisa adicionar ownership operacional, primeira emissao por Quantum, metadados, scopes, expiracao e request audit.
- `src/middleware/apiKeyAuth.ts`: injeta tenant/key/role no request; deve alimentar request audit sem confiar em payload do cliente.
- `src/middleware/rbacGuard.ts`: base de roles API (`ADMIN > OPERATOR > READER`); precisa ser conciliada com Platform Admin vs Tenant Admin.
- `src/services/core-facets/CommissioningFacet.ts`, `src/services/core-facets/DeviceRegistryFacet.ts` e modelos `Device`/`EncodingSession`: base para ativacao fisica QTAG apos gravacao.
- `src/services/core-facets/BillingFacet.ts` e `src/routes/v1/webhookRoutes.ts`: exemplo existente de webhook/payment, mas MercadoPago atual nao deve virar contrato final de recebiveis.
- `../qc-dashboard/server/_core/trpc.ts`: contem `adminProcedure`, ponto natural para proteger rotas admin server-side no dashboard.

### Established Patterns
- Facets recebem `secureContext` injetado pelo backend e payload opaco; tenant scope deve vir do contexto, nunca do body.
- Controllers/routes devem ser adaptadores finos; regras de negocio ficam em facets/services.
- Prisma e a fonte canonica de dados no backend; qualquer saldo, ledger, tenant status e fila operacional precisa persistir ali.
- DLT e provider externos devem ficar atras de interfaces/adapters; nao acoplar regra comercial diretamente a uma chain ou provider.
- `qc-dashboard` ja tem fallback/demo para wallet/creditos; Phase 4 deve substituir o mock por contratos canonicos quando disponiveis.

### Integration Points
- Backend: novos modelos Prisma para tenant commercial profile, activation status, payment intents/events, credit ledger, QTAG ledger, fulfillment orders, API request audit e admin audit.
- Backend: novas facets/selectors ou REST admin routes para tenant admin, credit ledger, QTAG fulfillment, provider boundary e audit queries.
- Dashboard: novo modulo `/admin/platform` e `/admin/tenant`, usando `adminProcedure`/server-side authorization e componentes operacionais por tenant.
- `qc-record-module`: consumidor/operador do fulfillment QTAG para gravacao fisica e retorno de commissioning.
- `qc-business`: fonte de regras comerciais, planos, SKUs, pricing, politica de concessao, provider final e eventuais regras de white-label.

</code_context>

<specifics>
## Specific Ideas

- API request audit deve permitir ver quais API keys estao ativas por tenant e quais requisicoes cada tenant faz.
- Credit ledger interno e obrigatorio mesmo se houver tokenizacao/on-chain futura.
- Transfero deve ser tratada como candidata preferencial de anchor/provider de recebimentos, mas o contrato final continua TBD.
- Saldo QTAG e exibido ao cliente como disponivel/reservado/em fulfillment/ativo/falha, sem misturar com creditos.
- Tenant detail deve funcionar como cockpit operacional; filas separadas servem para trabalho diario de operadores Quantum.
- Backfill completo e cutover B2C nesta fase sao decisao do usuario; Phase 5 deve permanecer focada em B2B externo, nao em Tenant Quantum.

</specifics>

<deferred>
## Deferred Ideas

- Extrair `qc-admin` como app separado somente quando houver necessidade real de deploy/auth/compliance/brand/team ownership.
- Contrato final de integracao Transfero/provider, moedas suportadas, settlement, compliance e webhook security ficam para definicao com `qc-business` durante planejamento/pesquisa.
- Tokenizacao/on-chain de creditos pode existir futuramente como espelhamento/prova/liquidacao, mas nao substitui o ledger operacional desta fase.

</deferred>

---

*Phase: 04-b2b-admin-operations-console*
*Context gathered: 2026-05-17*
