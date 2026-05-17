---
phase: 04-b2b-admin-operations-console
status: ready_for_human_uat
created: 2026-05-17
last_updated: 2026-05-17T10:48:13Z
owner: Quantum Cert Platform Admin
---

# Fase 04 - UAT Humana

## Escopo

Validar o console operacional B2B, Tenant Quantum, backfill B2C, usuários/equipe por tenant, API keys, créditos, recebimentos, QTAG fulfillment e visão Tenant Admin antes de promover a Fase 5.

## Evidência Automatizada Já Coletada

- `qc-backend`: `npm test -- --run` passou com 54 arquivos e 385 testes.
- `qc-backend`: `npm run build` passou.
- `qc-dashboard`: `pnpm test` passou com 40 arquivos, 172 testes e 3 ignorados.
- `qc-dashboard`: `pnpm check` passou.
- `qc-dashboard`: `pnpm exec vitest run server/admin-e2e.test.ts server/admin.tenant-scope.test.ts` passou com 4 testes.
- Browser local:
  - aba `Team` sem sobreposição do último select;
  - `/admin/tenant` carregando dados do tenant resolvido pelo contexto;
  - `/admin/platform/queues/activations` carregando fila, filtros e paginação.

## Checklist de UAT

### 1. Tenant Quantum e Backfill

- [ ] Confirmar que `quantum-cert-platform` existe, está `ACTIVE`, `targetChain=STELLAR` e não pode ser removido por fluxo operacional comum.
- [ ] Rodar dry-run do backfill B2C com relatório JSON.
- [ ] Revisar contagens de usuários, dependentes, assets, créditos, QTAGs, conflitos e órfãos.
- [ ] Aprovar execução real do backfill.
- [ ] Rodar execução real com checkpoint/resume habilitado.
- [ ] Validar que usuários B2C ficaram como `TenantUser` do Tenant Quantum, não como tenants.
- [ ] Validar que CPF/documento ficou normalizado/hasheado nos vínculos rastreáveis e não exposto como PII pública/on-chain.

### 2. Platform Admin

- [ ] Entrar como Platform Admin (`dev@localhost` no ambiente local).
- [ ] Criar tenant B2B com slug sugerido automaticamente a partir do nome.
- [ ] Definir chain do tenant; `STELLAR` deve ser padrão.
- [ ] Preencher e editar perfil comercial do tenant.
- [ ] Validar que CNPJ/taxId duplicado é bloqueado.
- [ ] Ativar, suspender e arquivar tenant com motivo/auditoria.
- [ ] Confirmar que tenant arquivado não aparece na listagem padrão.

### 3. API Keys e Auditoria

- [ ] Criar primeira API key com escopos marcados por checkbox.
- [ ] Criar API keys adicionais com escopos diferentes.
- [ ] Confirmar que o segredo bruto aparece somente uma vez.
- [ ] Rotacionar e revogar API key.
- [ ] Suspender tenant e confirmar que API key não autentica quando tenant não está `ACTIVE`.
- [ ] Confirmar request audit sem payload sensível nem raw key.
- [ ] Filtrar API requests por key, selector, status e paginação.

### 4. Créditos, Compras e Recebíveis

- [ ] Conceder créditos com motivo.
- [ ] Ajustar/revogar créditos com motivo.
- [ ] Criar intenção de compra pelo fluxo local/fake provider.
- [ ] Confirmar que crédito só entra no ledger após confirmação do provider.
- [ ] Validar fila de pagamentos com failed/reversed/awaiting-provider.
- [ ] Registrar pendência: contrato final de Transfero/provider deve ser definido em `qc-business`.

### 5. QTAG

- [ ] Conceder saldo QTAG separado de créditos.
- [ ] Reservar QTAG para um Asset existente.
- [ ] Confirmar que o saldo disponível reduz e a reserva aparece na fila.
- [ ] Ver estados de emissão, gravação, QA, falha/retry, despacho e tracking.
- [ ] Confirmar que a TAG só fica ativa após commissioning físico confirmado.
- [ ] Registrar bloqueio se `qc-record-module`/writer físico não estiver disponível.

### 6. Usuários e Assets por Tenant

- [ ] Listar usuários/equipe no Tenant Detail.
- [ ] Criar usuário com role/status/documento.
- [ ] Editar usuário existente.
- [ ] Validar vínculo do Asset de perfil quando disponível.
- [ ] Validar lista de Assets associados por ownership/delegação.
- [ ] Confirmar que transferência B2C resolve destino como `TenantUser`/Asset de perfil ou vínculo pendente, nunca como novo tenant.

### 7. Tenant Admin

- [ ] Entrar com usuário Tenant Admin de tenant B2B.
- [ ] Acessar `/admin/tenant`.
- [ ] Confirmar que apenas dados do próprio tenant aparecem.
- [ ] Confirmar que Tenant Admin não consegue enviar `tenantId` arbitrário para ler outro tenant.
- [ ] Confirmar que ativação/suspensão/grants globais continuam reservados ao Platform Admin na Fase 4.

### 8. Consulta Pública

- [ ] Validar consulta pública de Asset comum.
- [ ] Validar consulta pública do Asset de perfil do tenant exibindo nome público do tenant, não `tenant-profile:<tenantId>`.
- [ ] Validar logotipo/branding do tenant quando disponível.
- [ ] Validar histórico público e contribuições aprovadas.
- [ ] Validar localização exibida como texto quando houver geocoding/label disponível; latitude/longitude permanecem fallback técnico.

## Bloqueios Conhecidos

- QTAG físico depende de writer/tag real e integração atualizada do `qc-record-module`.
- Provider real de recebimentos continua a definir; Transfero é a candidata preferencial, mas o contrato final pertence a `qc-business`.
- Backfill real só deve executar após aprovação humana do dry-run.

## Critério de Encerramento

A Fase 4 pode ser marcada como UAT aprovada quando os itens críticos acima forem executados no ambiente alvo, o dry-run/execute do backfill tiver relatório aprovado, e qualquer bloqueio externo estiver registrado com owner e decisão explícita de seguir ou postergar.
