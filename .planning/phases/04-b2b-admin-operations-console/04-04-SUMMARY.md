# Resumo da Fase 04 Plano 04

**Plan:** `04-04-PLAN.md`  
**Status:** complete  
**Completed:** 2026-05-17  

## Escopo Concluído

- Adicionado `CreditLedgerFacet` como fonte de verdade operacional para créditos, separado de `UserWallet`.
- Implementadas projeções de saldo disponível/reservado a partir de `CreditLedgerEntry`.
- Implementadas operações de crédito `GRANTED`, `ADJUSTED`, `REVOKED`, `RESERVED`, `CONSUMED`, `RELEASED` e `PURCHASED`.
- Admin concede, ajusta e revoga créditos com `actor`, `reason`, `correlationId` e `AdminAuditLog`.
- Reserva, consumo e liberação usam `idempotencyKey` para evitar dupla cobrança.
- Adicionado `ReceivablesProviderFacet` com boundary genérico de recebíveis e provider local/fake para testes.
- Mantida Transfero como candidata/TBD, sem acoplamento comercial no contrato atual.
- Implementado fluxo `PurchaseOrder -> PaymentIntent -> PaymentEvent(CONFIRMED) -> CreditLedgerEntry(PURCHASED)`.
- Webhook de recebíveis valida assinatura, deduplica por `provider/providerEventId` e não credita eventos inválidos ou repetidos.
- Adicionadas rotas admin para resumo/ledger de créditos, concessão/ajuste/revogação, criação de compra de créditos, pedidos e fila de eventos de pagamento.
- Adicionado endpoint público de webhook `/api/v1/webhooks/receivables/:provider`.
- Dashboard passou a expor `QCBackendClient.admin.credits.*` e `QCBackendClient.admin.payments.*`.
- Adicionados procedures tRPC para créditos, ledger, compras e fila de pagamentos.
- Tenant Detail agora mostra métrica real de créditos, aba `Credits` com ledger e formulário auditado, e aba `Purchases` com pedidos/eventos do provedor.
- Adicionada página `/admin/platform/queues/payments` para fila operacional de pagamentos.

## Commits

### qc-backend

- Pendente de commit neste resumo.

### qc-dashboard

- Pendente de commit neste resumo.

## Verificação

### qc-backend

- `npm test -- --run tests/credit-ledger.test.ts tests/payment-provider-boundary.test.ts` - passou, 9 testes
- `npm run build` - passou

### qc-dashboard

- `pnpm test -- admin.credits` - passou; Vitest executou a suíte encontrada, 139 testes passaram e 3 foram ignorados
- `pnpm check` - passou

## Notas

- O corte do fluxo B2C de compra na loja para `PaymentIntent`/ledger permanece no Plano 06, junto do cutover B2C e backfill.
- O Plano 05 deve continuar com QTAG entitlement ledger, saldo disponível/reservado e fila de gravação/despacho.
