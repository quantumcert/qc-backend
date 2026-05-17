# Resumo da Fase 04 Plano 05

**Plan:** `04-05-PLAN.md`  
**Status:** complete  
**Completed:** 2026-05-17  

## Escopo Concluído

- Adicionado `QTagFulfillmentFacet` com ledger próprio para saldo QTAG, separado dos créditos da aplicação.
- Implementadas operações `GRANTED`, `PURCHASED`, `RESERVED`, `CONSUMED` e `RELEASED` sobre `QTagLedgerEntry`.
- `reserveForAsset` valida tenant, Asset existente, ausência de device ativo, saldo disponível e idempotência.
- Reserva QTAG cria `QTagFulfillmentOrder` com status inicial `REQUESTED`.
- Cancelamento/release antes da ativação devolve saldo por ledger auditável; QTAG já ativada não é recreditada silenciosamente.
- `commissioning.start` aceita `fulfillmentOrderId`, valida tenant/Asset/status e cria `EncodingSession` vinculada ao pedido.
- `commissioning.confirm(success=true)` valida sessão/tenant/UID, cria/atualiza `Device`, vincula `Asset.deviceId`, marca order como `ACTIVATED` e consome a reserva QTAG.
- Falha de commissioning antes da ativação marca a order como `ENCODING_FAILED` sem consumir entitlement.
- Adicionadas rotas admin de resumo/ledger QTAG, concessão, reserva por Asset, release/cancelamento, transição de status e fila global de fulfillment.
- Dashboard passou a expor `QCBackendClient.admin.qtags.*` e procedures tRPC correspondentes.
- Tenant Detail agora mostra métrica real de QTAG, aba `QTAGs` com saldo, concessão, reserva por Asset, ledger e fila.
- Adicionada página `/admin/platform/queues/qtags` para fila operacional de QTAG.

## Commits

### qc-backend

- `d23a7fb feat(04-05): add qtag fulfillment ledger`

### qc-dashboard

- `7084524 feat(04-05): add admin qtag queue`

## Verificação

### qc-backend

- `npm test -- --run tests/qtag-fulfillment.test.ts tests/commissioning.test.ts` - passou, 20 testes
- `npm run build` - passou

### qc-dashboard

- `pnpm test -- admin.qtags` - passou; Vitest executou a suíte encontrada, 142 testes passaram e 3 foram ignorados
- `pnpm check` - passou

## Notas

- A fila QTAG já expõe estados operacionais; ações finas de QA/retry/despacho podem ser aprofundadas no Plano 07 de UAT/admin cross-repo.
- O `qc-record-module` continua sendo a camada física de gravação; este plano deixou o contrato backend pronto para `commissioning.start/confirm` com `fulfillmentOrderId`.
