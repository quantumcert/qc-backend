# Resumo da Fase 04 Plano 06

**Plan:** `04-06-PLAN.md`  
**Status:** complete  
**Completed:** 2026-05-17  

## Escopo Concluído

- Adicionado `TenantUserFacet` como contrato canônico de usuários tenant-scoped.
- `ensureTenantQuantum` garante o tenant principal `quantum-cert-platform`, ativo e com `targetChain=STELLAR`.
- Usuários B2C ficam sob Tenant Quantum como `TenantUser`; usuários finais não viram tenants.
- CPF é normalizado como `document` e protegido contra duplicidade pelo serviço.
- Perfil de usuário cria/atualiza um `Asset` de perfil com `EventLog` aprovado e payload contendo CPF normalizado e hash.
- Adicionadas rotas `/api/v1/users` para upsert B2C, perfil, dependentes e identidades externas.
- Adicionadas rotas Platform Admin para listar, criar, editar, alterar status/role, consultar Asset de perfil e Assets associados por usuário.
- Criado `TenantQuantumBackfillFacet` com dry-run/execute, `MigrationRun`, checkpoints, records, conflitos, warnings e checksum.
- Adicionado script `src/scripts/backfill-tenant-quantum.ts` com `--dry-run`, `--execute`, `--batch-size`, `--resume`, `--report-json`, `--source-json` e leitura via `psql` quando `DASHBOARD_DATABASE_URL`/`QC_DASHBOARD_DATABASE_URL` estiver configurado.
- Backfill executa upsert idempotente por chaves legadas, reconcilia `Owner.ownerRef`, migra créditos para `CreditLedgerEntry` e saldo QTAG para `QTagLedgerEntry` sem tocar wallet financeira.
- `qc-dashboard` ganhou `QCBackendClient.users.*` e `admin.tenantUsers.*`.
- A sincronização de perfil do dashboard passou a usar `users.upsertB2C`, deixando o Asset de perfil sob o contrato canônico do backend.
- A aba `Team` do detalhe do tenant agora lista/cria/edita usuários reais, com filtros, paginação, status, role, Asset de perfil e ativos associados.

## Commits

### qc-backend

- `48878f4 feat(04-06): add canonical tenant users backfill`

### qc-dashboard

- `de71633 feat(04-06): add tenant users admin panel`

## Verificação

### qc-backend

- `pnpm build` - passou
- `pnpm exec vitest run tests/tenant-user-contracts.test.ts tests/tenant-backfill.test.ts` - passou, 7 testes

### qc-dashboard

- `pnpm check` - passou
- `pnpm exec vitest run server/wallet.credits.test.ts server/auth.login.test.ts server/auth.logout.test.ts server/auth.dependents.test.ts server/assets.create.test.ts server/assets.update.test.ts server/assets.visibility.test.ts server/assets.extended.test.ts` - passou, 25 testes e 1 ignorado
- Playwright em `http://localhost:3001/admin/platform/tenants/cmoj5dsj90000pv6aexegffxc` - aba `Team` abre e renderiza filtros, paginação e estado vazio sem sobrepor a barra fixa

## Notas

- O banco do dashboard ainda mantém sessão/autenticação e preferências locais; domínio rastreável de perfil passa a sincronizar pelo backend canônico.
- O execute real do backfill deve ser precedido por `--dry-run` aprovado e relatório revisado.
- A Phase 5 fica responsável por self-service completo de Tenant Admin/equipe B2B externa; este plano entrega operação por Platform Admin.
