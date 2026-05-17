# Resumo da Fase 04 Plano 03

**Plan:** `04-03-PLAN.md`  
**Status:** complete  
**Completed:** 2026-05-17  

## Escopo Concluído

- Adicionados contratos backend de ciclo de vida de API keys para Platform Admin em `/api/v1/admin/platform/tenants/:tenantId/api-keys`.
- Adicionado `AdminApiKeyOperationsFacet` para emissão inicial, listagem, rotação e revogação com auditoria de actor/reason.
- Mantido segredo bruto de API key como exibição única apenas na criação/rotação; respostas de listagem expõem somente prefixo e metadados.
- Adicionado middleware de auditoria sanitizada de requests com API key, persistindo metadados de método/path/selector/status/latência/correlation sem raw key, headers ou payload de body.
- Adicionada listagem backend de request audit em `/api/v1/admin/platform/tenants/:tenantId/request-audit`.
- Travada a identidade do tenant plataforma Quantum Cert como canônica e não sobrescrevível: slug `quantum-cert-platform`, nome `Quantum Cert`, contato `platform@quantumcert.com`.
- Ajustado `seed-bootstrap` para normalizar o tenant Quantum Cert em toda execução, incluindo status Enterprise ativo e limpeza de flags de suspensão/arquivamento.
- Feito backfill dos aliases locais de Platform Admin para `dev-user-001`, `dev@localhost` e `dev@local.host`.
- Alinhados os defaults de identidade Platform Admin em desenvolvimento no `qc-dashboard` com o seed do backend.
- Adicionados procedures tRPC no dashboard para API keys e request audit.
- Adicionada aba `API Keys` no Tenant Detail com tabela de chaves ativas, emissão inicial, rotação, revogação e diálogos de segredo bruto exibido uma única vez.
- Adicionada aba `Requests` no Tenant Detail e página `/admin/platform/audit` com filtros por tenant/key/selector/status/correlation.

## Commits

### qc-backend

- `b3a0a35 fix(04-03): align quantum cert platform tenant`
- `9bf5929 feat(04-03): add admin api key lifecycle`
- `b4698b9 fix(04-03): lock quantum cert platform tenant`
- `d95eb8c feat(04-03): audit api key requests`
- `8adeead feat(04-03): expose admin request audit listing`
- `b2b0ac3 fix(04-03): make platform tenant seed canonical`

### qc-dashboard

- `8c49001 fix(04-03): align dashboard platform admin identity`
- `b1133d0 feat(04-03): add admin api key dashboard`

## Verificação

### qc-backend

- `npm test -- --run tests/admin-authorization.test.ts tests/admin-api-keys.test.ts tests/api-request-audit.test.ts` - passou, 18 testes
- `npm run build` - passou
- `npm run seed:bootstrap` - passou; normalizou o tenant Quantum Cert `cmoj5dsj90000pv6aexegffxc` com slug `quantum-cert-platform`
- `curl /api/v1/admin/platform/tenants/cmoj5dsj90000pv6aexegffxc/api-keys` com `X-Admin-User-Id: dev@localhost` - retornou 200 e somente metadados da chave ativa
- `curl /api/v1/admin/platform/tenants/cmoj5dsj90000pv6aexegffxc/request-audit` com `X-Admin-User-Id: dev@localhost` - retornou 200 e resultado vazio sanitizado de auditoria

### qc-dashboard

- `pnpm test -- admin.api-keys` - passou; Vitest encontrou e executou a suíte completa do dashboard, 135 passou e 3 foram ignorados
- `pnpm check` - passou
- Validação no navegador em `http://localhost:3001`:
  - `/admin/platform/tenants` lista `Quantum Cert` com slug `quantum-cert-platform`
  - Tenant Detail da Quantum Cert mostra a aba API Keys com metadados de prefixo ativo e sem segredo bruto
  - Aba Requests do Tenant Detail carrega sem 404 de backend após reiniciar o backend
  - `/admin/platform/audit` carrega filtros de request audit por tenant e estado vazio

## Notas

- Criação de usuários pelo admin ainda não foi implementada neste slice. A aba `Team` no Tenant Detail permanece como placeholder e deve ser tratada no slice posterior de administração de equipe/tenant.
- Um backend local desatualizado causou um 404 inicial em `/request-audit` durante a validação no navegador. Reiniciar `npm run dev` no `qc-backend` carregou a rota atual e resolveu o problema.
