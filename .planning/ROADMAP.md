# ROADMAP — Quantum Cert Backend

_Generated: 2026-05-08 | Granularity: standard | Mode: mvp_
_Coverage: 73 requirements mapped_
_GitHub Project: https://github.com/orgs/quantumcert/projects/1_

---

## GitHub Milestone Mapping

| GSD Phase | GitHub Milestone | Issues     |
| --------- | ---------------- | ---------- |
| Phase 1   | Milestone #1     | #5, #7, #8 |
| Phase 2   | Milestone #2     | #12, #2    |
| Phase 3   | Milestone #3     | #11        |
| Phase 4   | TBD              | TBD        |
| Phase 5   | TBD              | TBD        |
| Phase 6   | TBD              | TBD        |
| Phase 7   | Milestone #4     | #13        |
| Phase 8   | Milestone #5     | #3         |
| Phase 9   | Milestone #6     | #10, #15   |

> Each GSD plan within a phase maps to a GitHub Issue (existing or new).
> Branch naming: `{issue-number}-{type}-{description}`
> Cross-repo scope: requisitos podem atravessar `qc-backend`, `qc-dashboard`, `qc-home` e `qc-record-module`; decisões de negócio devem ser tratadas em `qc-business`.

---

## Phases

- [x] **Phase 1: Core Gap Closure + Production Hardening** _(4/4 plans complete)_ — Fechar falhas de segurança críticas e conectar features inacessíveis antes de qualquer expansão
- [ ] **Phase 2: Document Verification + QTAG Production** _(3/3 plans complete; human UAT pending)_ — Verificação pública de documentos e NFC commissioning funcionando em produção
- [x] **Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority** _(complete; UAT passed; PRs merged)_ — Adapter Stellar para hackathon + infraestrutura multi-chain
- [ ] **Phase 4: B2B Admin Operations Console** _(7/7 plans complete; human UAT pending)_ — Área admin no `qc-dashboard` para cadastrar empresas/tenants, editar perfil com Asset canônico/ancoragem, administrar usuários/equipe por tenant, ativações, API keys, compras, recebimentos via provider, concessão de créditos, saldo/fila QTAG, Tenant Quantum, backfill e operação comercial B2B
- [ ] **Phase 5: B2B Tenant External Readiness** — Tenants B2B externos operam com admins, operadores, API keys, créditos, QTAGs, auditoria e boundaries white-label/públicos próprios após Tenant Quantum/backfill da Phase 4
- [ ] **Phase 6: On-chain Asset Identity + Provenance** — Todo perfil, dependente, pet, objeto, documento e QTAG tem Asset local + Asset/registro on-chain e rastreabilidade por eventos na Stellar/Soroban
- [ ] **Phase 7: Scale + Observability Infrastructure** — Redis, Pino, Sentry, BullMQ — plataforma multi-instância pronta para carga real
- [ ] **Phase 8: EscrowFacet + Time-Lock Oracle + M2M** — Escrow on-chain com time-lock e registro de agentes IoT
- [ ] **Phase 9: Specialized Domain Facets** — ERecycleFacet, transferência Multi-Party, biometria, contratos dinâmicos

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

**Completion note:** Backend proof and dashboard rendering are implemented; Stellar testnet UAT passed and evidence is recorded in `03-HUMAN-UAT.md`. Shipping PRs were merged: `qc-backend#23` and `qc-dashboard#23`.

**Plans**: 3 plans, 3 waves
**Cross-repo note:** dashboard proof display belongs to `qc-dashboard` and must render every `blockchain.chain`, not only Stellar; any monetization/pricing decision, including x402/Anchor/BRZ direction, belongs to `qc-business` before it becomes a hard implementation requirement.

**Wave 1**

- [x] 03-01-PLAN.md — Stellar/Soroban provisioning + tenant-safe anchoring

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 03-02-PLAN.md — Public blockchain proof + optional document payment hook

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 03-03-PLAN.md — Cross-chain dashboard proof card + UAT + scope reconciliation

### Phase 4: B2B Admin Operations Console

**Goal**: Quantum Cert tem uma área admin operacional no `qc-dashboard` para cadastrar e administrar clientes/empresas B2B, tenants, ativações, API keys, compras, recebimentos via provider, concessão de créditos, saldo/fila QTAG, Tenant Quantum, backfill e cutover B2C, deixando a Phase 5 para prontidão B2B externa
**Mode:** mvp
**GitHub Milestone**: TBD
**GitHub Issues**: TBD
**Depends on**: Phase 3
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-07, ADMIN-08, ADMIN-09, ADMIN-10, ADMIN-11, ADMIN-12, ADMIN-13, ID-01, ID-02, ID-03, ID-04, ID-05, ID-06
**Success Criteria** (what must be TRUE):

1. O admin operacional é entregue como módulo isolado dentro do `qc-dashboard`, com rotas/admin shell próprios; `qc-admin` fica como extração futura, não como requisito desta fase.
2. Platform Admin Quantum consegue cadastrar cliente/empresa B2B, criar o Tenant correspondente com slug sugerido automaticamente a partir do nome e editavel, definir a chain do tenant com `STELLAR` como padrão, preencher perfil comercial, contatos, plano, limites e status.
2a. CNPJ/taxId é chave única de Tenant B2B; duplicidade bloqueia criação/edição e o perfil do tenant registra chave determinística derivada do CNPJ normalizado.
2b. Perfil do tenant é editável no admin e cada criação/alteração mantém um `Asset` canônico cujo `externalId` público é o nome visível do Tenant em CAIXA ALTA, com fallback interno para o legado `tenant-profile:<tenantId>`, `targetChain`, `EventLog` aprovado e `signatureHash` pronto para ancoragem.
3. Platform Admin consegue ativar, suspender e arquivar tenants com fluxo auditável.
4. Platform Admin consegue criar múltiplas API keys por tenant, rotacionar e revogar, com secret hasheado, prefixo visível, escopos canônicos selecionáveis por checkbox, expiração e auditoria; API keys só autenticam quando o tenant está `ACTIVE` e chamadas Diamond/REST são bloqueadas quando a chave não possui o escopo exigido.
5. A área admin contempla compras, ativações, recebimentos, concessão/revogação/ajuste de créditos e histórico operacional por tenant.
6. Tenant Admin B2B visualiza apenas dados do próprio tenant: perfil permitido, créditos, compras, API keys, usuários/equipe e status de ativação.
6a. Platform Admin consegue listar, criar e editar usuários/equipe de qualquer tenant pelo Tenant Detail, ver status/papel/identidade externa, CPF/documento único, vínculo de Asset de perfil quando existir e Assets associados por ownership/delegação, com mutações auditadas.
7. Toda mutação privilegiada usa autorização server-side; esconder menu na UI não conta como controle de segurança.
8. Eventos de auditoria registram actor, tenant, ação, timestamp e payload hash/referência para cada operação crítica.
9. Créditos de uso da aplicação são geridos por ledger próprio, separado de saldo financeiro/on-chain; compra de créditos só altera crédito disponível após pagamento confirmado.
10. Recebimentos não custodiam wallet do cliente diretamente; Transfero é candidata preferencial para anchor/provider de recebimentos, mas a implementação final fica a definir atrás de uma interface de provider.
11. Compra de TAG física gera saldo/entitlement de QTAG disponível, separado de créditos de registro e exibido ao cliente.
12. Ao usar uma QTAG, o usuário deve selecionar um Asset existente; o sistema reserva/consome uma unidade de saldo QTAG e cria pedido de emissão/gravação vinculado ao Asset.
13. A fila admin operacional mostra QTAGs pendentes de emissão, gravação, QA, falha/retry, despacho e tracking; a TAG só fica ativa após confirmação de gravação/commissioning físico, não na compra.
14. Tenant Quantum existe como tenant canônico para B2C, com usuários/dependentes do `qc-dashboard` migrados para usuários tenant-scoped no backend.
15. O backfill é idempotente, tem dry-run, execução completa, relatório de conflitos/órfãos/diffs e resolve ownership/credits/QTAGs quando a origem permite.
16. O cutover B2C usa backend canônico para usuários, dependentes, créditos e ownership; banco local do dashboard fica limitado a sessão/preferências temporárias.
16a. Fluxos de transferência B2C resolvem remetente/destinatário para `TenantUser` + Asset de perfil dentro do Tenant Quantum, usando CPF/documento como chave única normalizada/hasheada; transferir para um CPF desconhecido cria vínculo pendente de usuário/perfil, não um novo tenant.

**Plans**: 7 plans, 6 waves

**Wave 0**

- [x] 04-01-PLAN.md — Canonical schema, Platform/Tenant Admin authorization, Tenant Quantum/backfill foundation: ADMIN-01, ADMIN-07, ADMIN-08, ID-01, ID-02 — DONE 2026-05-17

**Wave 1** _(blocked on Wave 0)_

- [x] 04-02-PLAN.md — Platform admin tenant lifecycle, commercial profile, activation/suspension and dashboard tenant hub: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-07, ADMIN-08 — DONE 2026-05-17

**Wave 2** _(blocked on Wave 1 for tenant contracts; plans can run in parallel)_

- [x] 04-03-PLAN.md — API key create/list/rotate/revoke, scoped route enforcement plus sanitized request audit: ADMIN-01, ADMIN-04, ADMIN-08 — DONE 2026-05-17
- [x] 04-04-PLAN.md — Credit ledger, purchase/payment/provider boundary and payment queue: ADMIN-05, ADMIN-06, ADMIN-08, ADMIN-09, ADMIN-10 — DONE 2026-05-17

**Wave 3** _(blocked on schema, tenant lifecycle and credit/provider foundation)_

- [x] 04-05-PLAN.md — QTAG entitlement ledger, fulfillment order, operational queue and commissioning activation link: ADMIN-08, ADMIN-11, ADMIN-12, ADMIN-13 — DONE 2026-05-17

**Wave 4** _(blocked on schema, credit ledger and QTAG ledger)_

- [x] 04-06-PLAN.md — Tenant Quantum, complete B2C backfill, Platform Admin tenant-user contracts, ownership/credits/QTAG reconciliation and dashboard B2C cutover: ADMIN-08, ADMIN-09, ID-01, ID-02, ID-03, ID-04, ID-05, ID-06 — DONE 2026-05-17

**Wave 5** _(blocked on operational slices)_

- [x] 04-07-PLAN.md — Platform queues, Platform Admin tenant-user UI, Tenant Admin constrained view, cross-repo verification and UAT closure: ADMIN-01..13, ID-01..06 — DONE 2026-05-17

**Completion note:** Implementation and automated validation are complete. Human UAT remains pending for approved backfill execution, provider/Transfero contract validation and physical QTAG commissioning with `qc-record-module`.

**Cross-repo note:** `qc-dashboard` implementa a interface; `qc-backend` define os contratos, autorização, tenant/API-key/credit ledger, QTAG entitlement ledger, QTAG fulfillment queue, purchase/payment intents, provider adapter e auditoria; `qc-record-module` executa gravação/commissioning físico; `qc-business` define regras comerciais, planos, pricing, compras, política de concessão de créditos/TAGs e escolha final do provider de recebimento.

**Placement decision:** começar no `qc-dashboard` porque reduz duplicação e usa a autenticação/experiência operacional atual. Separar em `qc-admin` só quando houver necessidade real de deploy separado, SSO interno, boundary de compliance, marca própria ou escala de manutenção.

**Wallet/credits decision:** "Wallet" na aplicação deve ser tratado como conta operacional/financeira + carteira de créditos, não como custódia direta da wallet blockchain do cliente. Para compra de créditos, o fluxo alvo é `PurchaseOrder`/`PaymentIntent` -> confirmação por provider externo -> `CreditLedgerEntry(PURCHASED)` -> créditos disponíveis. Transfero entra como candidata preferencial para anchor de recebimentos, mas a integração final e o contrato exato ficam marcados como implementação a definir.

**QTAG purchase/fulfillment decision:** QTAG física é entitlement/saldo separado de créditos. Comprar TAG não ativa chip nem cria vínculo físico final; apenas aumenta `availableQTags`. O uso acontece quando o cliente escolhe qual Asset deve receber a TAG. Nesse momento uma unidade é reservada/consumida, um pedido de emissão é criado, e a fila operacional conduz gravação, QA e despacho. A ativação da TAG acontece somente após `commissioning.confirm(success=true)` ou evento operacional equivalente definido no plano.

**Tenant profile Asset decision:** A Fase 4 já cria o primeiro bridge operacional da visão "tudo é Asset": o perfil comercial do tenant deve ser editável no admin, materializado como `Asset` local com `externalId` público igual ao nome visível do Tenant em CAIXA ALTA para manter a Consulta Pública em padrão legível, e registrado em `EventLog` aprovado para entrar na fila de ancoragem. Registros legados com `externalId` `tenant-profile:<tenantId>` devem ser reaproveitados/migrados na próxima edição, sem duplicar Asset. A Fase 6 continua responsável por generalizar o modelo para perfis B2C, dependentes, pets, objetos, documentos e QTAGs.

**Tenant CNPJ decision:** CNPJ/taxId normalizado é chave única operacional de Tenant B2B. O backend deve bloquear duplicidade antes de criar/editar o perfil comercial, manter constraint única em `TenantCommercialProfile.taxId` e gravar no Asset/evento do tenant uma chave determinística derivada do CNPJ para rastreabilidade.

**Tenant user/admin decision:** A Fase 4 deve permitir que Platform Admin visualize, crie e edite usuários/equipe de qualquer tenant no Tenant Detail, incluindo vínculo de identidade externa, role/status, CPF/documento único, Asset de perfil quando existir e Assets associados por ownership/delegação. Quando o perfil do usuário for registrado como Asset/on-chain, a transação deve conter uma chave determinística derivada do CPF normalizado, como hash, sem gravar CPF bruto em payload público ou imutável. A Fase 5 fica responsável por transformar essa fundação em self-service B2B completo para Tenant Admin, com convites, operadores, políticas e limites próprios do tenant.

**User asset history/transfer decision:** Usuário final B2C não vira Tenant. Ele é `TenantUser` do Tenant Quantum e tem um Asset de perfil. O histórico consultável do usuário deve agregar dois eixos: eventos do próprio Asset de perfil e eventos dos Assets em que ele é owner/delegado/destinatário de transferência. Transferências devem registrar `fromProfileAssetId`, `toProfileAssetId` quando disponível, hashes de documento/ownerRef e evento de ownership na chain; CPF bruto não deve ser payload público/on-chain.

**Tenant chain decision:** Como a plataforma será multichain, `Tenant.targetChain` é o roteador canônico de ancoragem do tenant. O padrão operacional é `STELLAR`; a UI admin deve permitir escolher outra chain suportada quando necessário, e o Tenant Quantum/Quantum Cert deve ser normalizado sempre com `targetChain=STELLAR`.

**API key scope decision:** Escopos de API key são catálogo canônico, não texto livre. O cadastro no dashboard usa checkboxes, dashboard/backend rejeitam escopos fora do catálogo, defaults dependem da role (`READER`, `OPERATOR`, `ADMIN`) e o runtime aplica a permissão por selector Diamond e por rotas REST mapeadas antes da execução. Tenants podem ter múltiplas chaves ativas separadas por integração/uso operacional.

### Phase 5: B2B Tenant External Readiness

**Goal**: Tenants B2B externos ficam prontos para operar com admins, operadores, API keys, créditos, QTAGs, auditoria, consumo por API e boundaries white-label/públicos próprios, partindo do Tenant Quantum/backfill e da fundação admin entregues na Phase 4
**Mode:** mvp
**GitHub Milestone**: TBD
**GitHub Issues**: TBD
**Depends on**: Phase 4
**Requirements**: B2B-01, B2B-02, B2B-03, B2B-04, B2B-05, B2B-06
**Success Criteria** (what must be TRUE):

1. Um tenant B2B criado/ativado na Phase 4 tem admins e operadores tenant-scoped separados do Tenant Quantum, partindo dos usuários/equipe já visíveis e editáveis por Platform Admin.
2. Tenant Admin B2B gerencia equipe, convites, operadores, API keys permitidas, créditos, QTAGs, compras e auditoria apenas do próprio tenant.
3. API keys B2B têm scopes, auditoria de requisições, limites e visibilidade de consumo adequados para tenants externos.
4. Tenant Admin B2B não acessa rotas Platform Admin, grants globais, ativação cross-tenant nem auditoria de outros tenants.
5. Boundaries white-label/públicos por tenant ficam explícitos e não vazam payloads privados de admin/billing.
6. Um tenant B2B piloto completa onboarding -> chamada API -> operação de créditos/QTAG -> consulta pública usando contratos tenant-scoped.

**Plans**: TBD
**Cross-repo note:** Esta fase é transversal a `qc-backend`, `qc-dashboard` e `qc-home`; depende da Phase 4 para admin operacional, Tenant Quantum/backfill, API keys, créditos e QTAG ledgers; `qc-business` deve confirmar regras comerciais/planos/white-label antes do piloto B2B.

**Dependência da Fase 4:** Tenant Quantum, usuários B2C canônicos, migration engine, backfill completo de usuários/dependentes do dashboard, console admin B2B, Platform Admin CRUD de usuários/equipe por tenant, fundação tenant/API key, ledgers de crédito/QTAG e filas de fulfillment são entregues pela Fase 4. A Fase 5 começa a partir desses artefatos e foca a prontidão de tenants B2B externos, especialmente self-service de equipe/operadores pelo Tenant Admin.

### Phase 6: On-chain Asset Identity + Provenance

**Goal**: Todo ativo do produto — perfil, dependente, pet, objeto, documento, QTAG e futuros tipos — tem identidade de Asset local, registro on-chain e trilha de eventos consultável tanto pela aplicação quanto pela Stellar/Soroban
**Mode:** mvp
**GitHub Milestone**: TBD
**GitHub Issues**: TBD
**Depends on**: Phase 5
**Requirements**: OCHAIN-01, OCHAIN-02, OCHAIN-03, OCHAIN-04, OCHAIN-05, OCHAIN-06
**Success Criteria** (what must be TRUE):

1. Todo caminho de criação de perfil, dependente, pet, objeto, documento ou QTAG passa pelo Asset Engine e cria um Asset local tenant-scoped antes de qualquer publicação.
2. Cada Asset local recebe identidade Stellar própria (`asset_code + issuer`) e registro Soroban de proveniência, com identificadores públicos, hash do CPF/documento normalizado quando o Asset representar perfil de pessoa, hashes e vínculos suficientes para verificação sem expor PII.
3. Eventos aprovados de lifecycle, ownership, delegação, QTAG, scan, documento e incidente são registrados na chain como trilha ordenada, com hash do payload e referência ao evento anterior quando aplicável.
4. A API pública e o dashboard exibem uma visão única: dados públicos do app + prova on-chain + link Stellar Expert/contrato, sem divergência entre timeline local e timeline on-chain confirmada.
4a. A consulta de histórico de um usuário retorna eventos do Asset de perfil do usuário e eventos dos Assets que pertencem/pertenceram a ele por ownership, delegação ou transferência.
4b. Transferências de Asset entre usuários registram evento on-chain com vínculos para os Assets de perfil de origem/destino quando disponíveis e hashes de documento/ownerRef, sem expor CPF bruto.
5. Backfill cria registros on-chain faltantes para assets existentes, em fila idempotente, com relatório de pendências, retries e conflitos.
6. Uma QTAG/Device tem Asset próprio e vínculo obrigatório ao Asset protegido; eventos de emissão, commissioning, despacho, ativação e scan ficam rastreáveis na timeline/prova pública.

**Plans**: TBD
**Cross-repo note:** Esta fase depende da identidade/ownership canônica da Phase 4 e dos boundaries B2B da Phase 5. O `qc-dashboard` consome a prova unificada; `qc-record-module` deve parear QTAG físico com Asset existente sem expor internals de tenant.

### Phase 7: Scale + Observability Infrastructure

**Goal**: A plataforma opera corretamente em múltiplas instâncias simultâneas com observabilidade de produção completa
**Mode:** mvp
**GitHub Milestone**: [#4](https://github.com/quantumcert/qc-backend/milestone/4)
**GitHub Issues**: [#13](https://github.com/quantumcert/qc-backend/issues/13) (Revisar mensagens de erro/docs)
**Depends on**: Phase 5, Phase 6
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07
**Success Criteria** (what must be TRUE):

1. Duas instâncias do servidor em rolling deploy compartilham o mesmo estado de rate limiting e idempotency — nenhum request passa duas vezes nem é bloqueado incorretamente
2. Todos os logs da plataforma aparecem em formato JSON estruturado com campos `tenantId`, `requestId`, `level` — nenhuma chamada `console.*` permanece
3. Uma exceção não tratada em produção gera um evento Sentry com contexto de tenant e request — diagnóstico sem acesso ao servidor
4. Um job de anchoring que falha é reenfileirado automaticamente pelo BullMQ — sem perda de eventos financeiros por fire-and-forget
5. O endpoint `GET /health` retorna profundidade da fila AnchorQueue e status das DLT connections — operador monitora sem acessar banco diretamente

**Plans**: TBD

### Phase 8: EscrowFacet + Time-Lock Oracle + M2M

**Goal**: Assets podem ser travados em escrow on-chain com liberação automática por tempo, e dispositivos IoT autenticados podem injetar eventos com assinatura Falcon
**Mode:** mvp
**GitHub Milestone**: [#5](https://github.com/quantumcert/qc-backend/milestone/5)
**GitHub Issues**: [#3](https://github.com/quantumcert/qc-backend/issues/3) (AgentRegistryFacet + qc-universal-gateway)
**Depends on**: Phase 6, Phase 7
**Requirements**: ESC-01, ESC-02, ESC-03, ESC-04, ESC-05, M2M-01, M2M-02, M2M-03
**Success Criteria** (what must be TRUE):

1. Um asset em estado `LOCKED_IN_ESCROW` não aceita nenhuma mudança de estado antes do `unlockTimestamp` — todas as tentativas retornam 409
2. Após `unlockTimestamp` expirar, o `EscrowReleaseWorker` libera o asset automaticamente — em rolling deploy com duas instâncias, o mesmo escrow é liberado exatamente uma vez
3. A lógica de liberação do escrow é executada no smart contract on-chain (TEAL) — não off-chain via cron apenas
4. Um dispositivo IoT autenticado pode submeter `POST /api/v1/agent/event` com payload Falcon-512 assinado — payload inválido é rejeitado com 401
5. Um agente não registrado para o tenant não consegue injetar eventos — `AgentRegistryFacet` valida pertencimento antes de processar

**Plans**: TBD

### Phase 9: Specialized Domain Facets

**Goal**: Facets de domínio especializado ampliam a plataforma para casos de uso avançados: créditos ambientais, transferência com múltiplas assinaturas, validação biométrica e geração automática de contratos
**Mode:** mvp
**GitHub Milestone**: [#6](https://github.com/quantumcert/qc-backend/milestone/6)
**GitHub Issues**: [#10](https://github.com/quantumcert/qc-backend/issues/10) (ERecycleFacet — resíduos + créditos ambientais), [#15](https://github.com/quantumcert/qc-backend/issues/15) (Transferência Multi-Party, Biometria, Contrato Dinâmico)
**Depends on**: Phase 8
**Requirements**: FACET-01, FACET-02, FACET-03, FACET-04, FACET-05
**Success Criteria** (what must be TRUE):

1. Um tenant pode registrar resíduos via `ERecycleFacet` e receber créditos ambientais ancorables em blockchain
2. Uma transferência de ownership exige N assinaturas configuráveis antes de ser processada — multi-party enforced pelo Facet
3. Validação biométrica bloqueia transferência sem match do owner cadastrado
4. Um contrato dinâmico é gerado automaticamente no evento de transferência com os dados do asset e das partes
5. Todos os novos Facets seguem a Golden Rule — zero termos de domínio específico no core, payload opaco

**Plans**: TBD

---

## Future Research Candidates

### B2C Consumer Onboarding

**Status:** structural pieces promoted into Phase 4/5/6 architecture work on 2026-05-17; remaining product/commercial questions stay with `qc-business`
**Scope:** cross-repo product research before implementation
**Repos likely involved:** `qc-dashboard`, `qc-backend`, `qc-home`, `qc-record-module`; business decisions in `qc-business`

**Product hypothesis:** B2C users should register assets under an operational Quantum Cert consumer tenant, for example `quantum-cert-consumer`, instead of becoming tenants themselves. The client experience should be "registre conosco", while tenant/API-key complexity stays internal.

**Preferred model to research first:** hybrid onboarding.

1. User creates a free draft asset.
2. Activation/certification consumes one registration credit or requires buying credits.
3. Physical QTAG is optional and can be bought/linked after the digital asset exists.

**Current codebase anchors:**

- `qc-dashboard` already has protected routes for store, profile, assets, and asset creation.
- Existing asset creation wizard can be reused for category, details, photos/documents, and public privacy.
- Existing wallet rule already supports credit-only activation through `creditsBalance`; production must replace fallback balance-derived credits with backend `CreditLedger`.
- Existing store already models QTAG/QTRACK and credit packages, but physical checkout remains simulated.
- Existing public verification route can become the post-onboarding certificate/QR destination.
- `qc-dashboard` already has a `user`/`admin` role concept and server-side `adminProcedure`; Phase 4 turns this into a dedicated operational admin module instead of a separate `qc-admin` app.

**Administrative area direction:** create a protected admin module in `qc-dashboard`, with two enforcement layers:

1. UI navigation only shows admin entries when the logged-in user has `role = admin`.
2. Server-side list/mutation routes use `adminProcedure`; hidden UI alone is not sufficient.

**Admin queues to research:**

- Pending: new registrations awaiting validation.
- Approved: assets published/certified.
- Rejected: records with reason and correction path for the user.
- Flagged: reports, suspicious records, bad documents, or inconsistencies.

**B2B flow to include in research:**

- B2B customers should likely remain real tenants with their own tenant profile, limits, billing/commercial terms, API keys, users, and operational workflows.
- B2B admins may need bulk asset import, team/user management, approval workflows, API access, branded public verification, QTAG batch fulfillment, and reporting.
- The admin area must distinguish Quantum Cert platform admins from tenant admins. Platform admins validate/operate the marketplace; tenant admins manage their organization's users/assets.
- B2B onboarding may need a sales/manual approval path before tenant activation, unlike low-friction B2C self-service.

**Research questions before planning:**

1. Which B2C model should be productized first: register-first, purchase-first, or hybrid?
2. What is the minimum public self-service account flow: email/password, magic link, social login, or invite?
3. What asset states are needed for consumers: draft, active digital, QTAG ordered, QTAG linked, blockchain anchored, incident reported?
4. What backoffice/admin review is required before activation, QTAG issuance, or public certificate publication?
5. Which steps belong in `qc-dashboard` versus `qc-home`, and which operational/business decisions belong in `qc-business`?
6. How should `qc-record-module` pair a delivered QTAG to an existing consumer asset without exposing tenant internals?
7. For admin validation, should assets be public/certified only after approval, active immediately with later audit, or hybrid by category/risk/value?
8. What role model is required across platform admin, tenant admin, B2B operator, and B2C owner?
9. What is the B2B onboarding path: self-service tenant signup, invitation, sales-assisted approval, or all three?
10. Which B2B operations require bulk workflows, API keys, billing controls, and branded verification pages?

**Promotion note:** The structural decision is locked: B2C users live under the Tenant Quantum, B2B customers remain separate tenants, the first operational admin surface ships inside `qc-dashboard` as an isolated module, and application credits are ledger-based rather than direct client-wallet custody. Product details such as signup method, pricing, QTAG fulfillment, approval SLAs, purchase policies, credit packages, provider/Transfero contract and white-label commercial packaging still require `qc-business` decisions before implementation plans are finalized.

---

## Progress Table

| Phase                                               | GitHub Milestone                                             | Issues     | Plans Complete | Status            | Completed  |
| --------------------------------------------------- | ------------------------------------------------------------ | ---------- | -------------- | ----------------- | ---------- |
| 1. Core Gap Closure + Production Hardening          | [M#1](https://github.com/quantumcert/qc-backend/milestone/1) | #5, #7, #8 | 4/4            | Complete          | 2026-05-09 |
| 2. Document Verification + QTAG Production          | [M#2](https://github.com/quantumcert/qc-backend/milestone/2) | #12, #2    | 3/3            | Human UAT pending | -          |
| 3. Pluggable DLT Workers — Stellar/Soroban Priority | [M#3](https://github.com/quantumcert/qc-backend/milestone/3) | #11        | 3/3            | Complete; PRs merged | 2026-05-14 |
| 4. B2B Admin Operations Console                     | TBD                                                          | TBD        | 7/7            | Implementation complete; human UAT pending | - |
| 5. B2B Tenant External Readiness                    | TBD                                                          | TBD        | 0/?            | Approved after Phase 4 | -      |
| 6. On-chain Asset Identity + Provenance             | TBD                                                          | TBD        | 0/?            | Approved after Phase 5 | -      |
| 7. Scale + Observability Infrastructure             | [M#4](https://github.com/quantumcert/qc-backend/milestone/4) | #13        | 0/?            | Deferred behind Phase 5/6 | -    |
| 8. EscrowFacet + Time-Lock Oracle + M2M             | [M#5](https://github.com/quantumcert/qc-backend/milestone/5) | #3         | 0/?            | Deferred behind Phase 7 | -       |
| 9. Specialized Domain Facets                        | [M#6](https://github.com/quantumcert/qc-backend/milestone/6) | #10, #15   | 0/?            | Deferred behind Phase 8 | -       |
