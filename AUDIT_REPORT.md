# 🔍 AUDIT REPORT — Codebase Integrity Scan

**Data:** 2026-02-15
**Scope:** `qc-backend-final/src/` (Controllers, Services, Middleware)
**Modo:** Somente diagnóstico — SEM alterações de código
**Status:** ✅ COMPLETO

---

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Vetor 1 — Integridade Transacional (Atomicidade)](#vetor-1--integridade-transacional-atomicidade)
3. [Vetor 2 — Gaps Operacionais (Fluxos Ausentes)](#vetor-2--gaps-operacionais-fluxos-ausentes)
4. [Vetor 3 — Tratamento de Erros Silenciosos](#vetor-3--tratamento-de-erros-silenciosos)
5. [Vetor 4 — Isolamento de Tenant (Multi-Tenancy)](#vetor-4--isolamento-de-tenant-multi-tenancy)
6. [Vetor 5 — Dívida Técnica Explícita (TODO/FIXME)](#vetor-5--dívida-técnica-explícita-todofixme)
7. [Matriz de Severidade Consolidada](#7-matriz-de-severidade-consolidada)
8. [Recomendação de Priorização](#8-recomendação-de-priorização)

---

## 1. Resumo Executivo

| Métrica                     | Valor |
|-----------------------------|-------|
| Arquivos auditados          | ~35   |
| Findings **CRÍTICOS**       | 5     |
| Findings **ALTOS**          | 7     |
| Findings **MÉDIOS**         | 7     |
| Findings **BAIXOS**         | 6     |
| **Total de Findings**       | **25** |

### O que está BOM ✅

- `WebhookController.handleGatewayWebhook` — Toda a liquidação financeira + entrega de ativo + comissões está dentro de **um único `prisma.$transaction`** (L137-221). Exemplar.
- `LedgerService.recordEntry` — Criação de ledger + incremento de saldo dentro de `$transaction` (L429-458).
- `LedgerService.recordDebit` — Usa `updateMany WHERE freeBalance >= amount` (race-condition-safe) dentro de `$transaction` (L542-571).
- `SmartSpendService.processSmartPayment` — Toda a lógica de débito multi-bolso está dentro de `prisma.$transaction` (L100-230).
- `AnticipationService.anticipate` — Loop de update + fee + balance move dentro de `prisma.$transaction` (L100-155).
- `EscrowWorker.runClearing` — Cada tx individual processada em `prisma.$transaction` com error isolation (L66-82).
- `billingMiddleware` — Política **FAIL-CLOSED** implementada corretamente. Erro no billing = 500/503, nunca pass-through (L257-275).
- `NfcSecurityMiddleware` — Validação anti-replay com counter monotônico + cooldown de 2s.

---

## Vetor 1 — Integridade Transacional (Atomicidade)

Operações financeiras ou de mudança de estado que **deveriam** estar dentro de `prisma.$transaction` mas **não estão**, criando risco de estado inconsistente em caso de falha parcial.

### ATOM-001 🔴 CRÍTICO — `WalletController.credit`: LedgerEntry + Comissão SEM transação unificada

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/WalletController.ts` |
| **Linhas**   | 81-100 |
| **Evidência** | `LedgerService.recordEntry()` na L81 e `CommissionService.processTripleSplit()` na L94 são chamados **sequencialmente**, sem wrapper `$transaction`. |
| **Risco**    | Se `recordEntry` sucede mas `processTripleSplit` falha, o crédito é registrado no ledger mas as comissões não são distribuídas. Dinheiro entra no sistema sem split correto. |
| **Agravante** | `processTripleSplit` **NÃO EXISTE** no `CommissionService` — o método é `distributeServiceFee`. Isso causará **runtime crash** (`TypeError: processTripleSplit is not a function`). |

```typescript
// L81-100 — Duas operações independentes sem atomicidade
const entry = await LedgerService.recordEntry({ ... });  // ← $transaction interna
if (assetId) {
    split = await CommissionService.processTripleSplit(...); // ← MÉTODO INEXISTENTE → CRASH
}
```

### ATOM-002 🟡 MÉDIO — `PaymentController.activate`: LifecycleFacet + paymentEnabled SEM transação

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/PaymentController.ts` |
| **Linhas**   | 182-193 |
| **Evidência** | `lifecycleFacet.changeState()` na L182 e `prisma.asset.update({ paymentEnabled: true })` na L190 são chamados **sequencialmente**. |
| **Risco**    | Se `changeState` sucede (estado ACTIVE, evento registrado, ancoragem Algorand) mas `prisma.asset.update` falha, o asset fica ACTIVE mas com `paymentEnabled: false`. O usuário não consegue pagar com o ativo. |

```typescript
// L182 — Operação 1 (fora de $transaction)
const result = await lifecycleFacet.changeState(assetId, userId, 'ACTIVE', ...);

// L190 — Operação 2 (fora de $transaction) — Pode falhar independentemente
await prisma.asset.update({ where: { id: assetId }, data: { paymentEnabled: true } });
```

### ATOM-003 🟡 MÉDIO — `OwnershipFacet.transferOwnership` (quando chamado standalone): DB update + Event SEM $transaction

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/core-facets/OwnershipFacet.ts` |
| **Linhas**   | 137-160 |
| **Evidência** | `db.asset.update` (L137) e `db.assetEvent.create` (L147) são operações separadas no mesmo `db` client. Quando chamado pelo `AssetController.transfer` (sem txClient), usa `prisma` diretamente — **sem $transaction**. |
| **Risco**    | Se `asset.update` sucede mas `assetEvent.create` falha, a ownership muda mas o evento de auditoria é perdido. A provenance on-chain fica incompleta. |
| **Nota**     | Quando chamado pelo `WebhookController` com `tx as any`, a atomicidade é garantida pelo wrapper externo. O risco é **apenas** na chamada standalone via `AssetController`. |

### ATOM-004 🟢 BAIXO — `PaymentLinkController.getCheckout`: Update status EXPIRED sem atomicidade com read

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/PaymentLinkController.ts` |
| **Linhas**   | 90-92 |
| **Evidência** | Read (L83) + conditional update (L91) sem lock/transaction. Dois requests simultâneos podem ambos "expirar" o link. |
| **Risco**    | Baixo — operação idempotente, mas logs podem mostrar dupla expiração. |

---

## Vetor 2 — Gaps Operacionais (Fluxos Ausentes)

Fluxos de negócio **esperados em produção** que não possuem implementação.

### GAP-001 🔴 CRÍTICO — Ausência TOTAL de lógica de Estorno/Refund

| Campo        | Valor |
|--------------|-------|
| **Evidência** | `grep -ri "refund\|estorno\|reverse\|chargeback" src/` → **ZERO resultados**. |
| **Risco**    | O sistema debita wallets e liquida transações, mas **não possui NENHUM mecanismo para reverter um pagamento**. Se um gateway reportar chargeback via webhook, não há handler. Se um cliente solicitar estorno, não há endpoint nem lógica no LedgerService. |
| **Impacto**  | Em caso de disputa com cartão de crédito, a plataforma perde dinheiro pois o gateway reverterá o valor, mas o saldo no wallet do merchant **não será devolvido**. Desequilíbrio contábil permanente. |

### GAP-002 🔴 CRÍTICO — `CommissionService.processTripleSplit` não existe

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/WalletController.ts:94` → chama `CommissionService.processTripleSplit()` |
| **Referência** | `src/services/financial/CommissionService.ts` exporta apenas: `distributeServiceFee`, `processReferral`, `transferCommission` |
| **Risco**    | Qualquer request `POST /api/v1/wallet/credit` com `assetId` no body causará **crash em runtime** → `TypeError: CommissionService.processTripleSplit is not a function`. O crédito na L81 já terá sido efetivado no ledger, mas o controller retornará 500. O usuário vê erro, mas dinheiro foi creditado. |

### GAP-003 🟠 ALTO — `WithdrawalService`: Saque sem integração real com PSP

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/financial/WithdrawalService.ts` |
| **Linhas**   | 95-96 |
| **Evidência** | `console.warn('[MOCK] PIX Transfer simulated. Money deducted from Ledger but NOT sent to bank.')` |
| **Risco**    | O LedgerService **DEBITA o saldo do usuário** via `recordDebit` (L82-93), mas o dinheiro **nunca sai da plataforma** para a conta bancária. Se for para produção assim, o usuário perde acesso ao saldo sem receber o PIX. |

### GAP-004 🟠 ALTO — `PaymentLinkController.processPayment`: Método QTAG não implementado

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/PaymentLinkController.ts` |
| **Linhas**   | 169-170 |
| **Evidência** | `// TODO: Implementar SmartSpendService para pagamento com Saldo QTAG` → retorna 501. |
| **Risco**    | Checkout links que oferecem `allowedMethods: ['PIX', 'CREDIT_CARD', 'QTAG']` listam QTAG como opção, mas ao tentar pagar com saldo QTAG, retorna "em manutenção". UX falha e perda de conversão. |

### GAP-005 🟡 MÉDIO — `PaymentController.charge` (External Card): Gateway processing não implementado

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/PaymentController.ts` |
| **Linhas**   | 92-93 |
| **Evidência** | `// In production: send emvToken to gateway API here` / `// For now, return the intent for async gateway processing` |
| **Risco**    | O SoftPOS Tap-to-Phone cria um `PaymentIntent` mas **nunca envia o token EMV ao gateway**. O pagamento ficará eternamente PENDING_GATEWAY. |

### GAP-006 🟡 MÉDIO — `RelayFacet.dispatchNotification`: Notificações são apenas console.log

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/core-facets/RelayFacet.ts` |
| **Linhas**   | 132-139 |
| **Evidência** | `// TODO: Integrar com serviço de email` / `// TODO: Integrar com push notification` |
| **Risco**    | O Blind Relay registra o evento no banco, mas o proprietário do ativo **nunca recebe a notificação** de que alguém entrou em contato. Funcionalidade core de recuperação de bens perdidos não funciona end-to-end. |

### GAP-007 🟡 MÉDIO — `ActivationMiddleware`: Push notification não implementado

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/middleware/ActivationMiddleware.ts` |
| **Linhas**   | 48-49 |
| **Evidência** | `// TODO: Disparar Push Notification/WebSocket aqui` |
| **Risco**    | Quando alguém tapa uma pulseira IN_TRANSIT, o sistema bloqueia corretamente (428), mas o dono **não é notificado** que precisa ativar. Depende do usuário adivinhar que precisa abrir o app. |

---

## Vetor 3 — Tratamento de Erros Silenciosos

Blocos `catch` que engolham erros, mascarando falhas e dificultando diagnóstico.

### ERR-001 🟠 ALTO — `billingMiddleware` (apiKeyResolver): Update silenciosamente descartado

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/middleware/billingMiddleware.ts` |
| **Linha**    | 126 |
| **Evidência** | `.catch(() => { })` no `prisma.apiKey.update({ lastUsedAt })` |
| **Risco**    | Se o DB falhar ao atualizar `lastUsedAt`, o erro é silenciosamente descartado. Em si é aceitável (non-blocking telemetry), mas se o problema for sistêmico (DB connection pool esgotado), **nenhum alerta será gerado**, mascarando degradação. |
| **Mitigação** | Adicionar pelo menos `console.warn` no catch. |

### ERR-002 🟠 ALTO — `billingMiddleware` (apiKeyResolver): Erro completo na resolução de API key é non-fatal

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/middleware/billingMiddleware.ts` |
| **Linhas**   | 131-135 |
| **Evidência** | Bloco catch no `apiKeyResolver` loga erro e chama `next()` — continua sem contexto B2B. |
| **Risco**    | Se a resolução da API key falhar (ex: DB down), o request **passa sem contexto de tenant**. O `billingMiddleware` downstream pode marcar como `billingCleared: true` para rotas non-billable, e o controller processará sem autenticação B2B. Pode permitir operações sem billing em cenário de falha de DB. |

### ERR-003 🟡 MÉDIO — `billingMiddleware`: Email resolution silenciada

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/middleware/billingMiddleware.ts` |
| **Linhas**   | 178-180 |
| **Evidência** | `} catch { // Non-fatal — we can generate charges without email }` |
| **Risco**    | Se a lookup de email falhar, cobranças Mercado Pago podem ser geradas sem email — impactando UX do pagamento, mas não é critical. |

### ERR-004 🟡 MÉDIO — `ACR122UService.shutdown`: Catch vazio na desconexão NFC

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/hardware/ACR122UService.ts` |
| **Linha**    | 576 |
| **Evidência** | `} catch { }` — sem logging nem handling. |
| **Risco**    | Se o NFC subsystem falhar ao fechar, o erro é completamente silenciado. Pode causar resource leak do PC/SC handle. |

### ERR-005 🟢 BAIXO — `PaymentRoutingService`: Error body parsing silenciado

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/financial/PaymentRoutingService.ts` |
| **Linhas**   | 109, 168 |
| **Evidência** | `await response.json().catch(() => ({}))` em dois locais. |
| **Risco**    | Se o response body do gateway for inválido (não-JSON), o erro de parsing é silenciado e um objeto vazio é usado. O erro original do gateway perde contexto de diagnóstico. Aceitável para resiliência, mas dificulta debug de integrações com Mercado Pago. |

### ERR-006 🟠 ALTO — `OwnershipFacet`: Falcon verification failure = `signatureValid = true`

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/core-facets/OwnershipFacet.ts` |
| **Linhas**   | 107-111 |
| **Evidência** | Se a verificação Falcon **fazer throw** (HSM indisponível), o catch block **seta `signatureValid = true`**, efetivamente bypassando a validação criptográfica. |
| **Risco**    | Qualquer indisponibilidade do HSM/serviço Falcon permite transferências sem validação de assinatura PQC. Em produção com HSM real, isso é um **bypass de segurança**. A lógica deveria rejeitar ou ter flag explícito. |

```typescript
// L107-111 — Falha no HSM = aprovação automática
} catch (error) {
    console.warn('[OwnershipFacet] Falcon verification unavailable:', ...);
    signatureValid = true; // ← BYPASS: Falha = Aprovado
}
```

---

## Vetor 4 — Isolamento de Tenant (Multi-Tenancy)

Queries que acessam dados **sem filtro por tenantId/ownerId**, potencialmente permitindo acesso cross-tenant.

### TENANT-001 🔴 CRÍTICO — `VeraAgentController.getAbandonedCarts`: Dados de TODOS os tenants expostos

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/VeraAgentController.ts` |
| **Linhas**   | 24-37 |
| **Evidência** | `prisma.paymentIntent.findMany` sem filtro de `tenantId`. Retorna intents de **todos** os tenants. |
| **Risco**    | A VERA (ou qualquer chamador do endpoint) tem acesso a dados de abandono de carrinho de **todos os merchants da plataforma**, incluindo valor, device ID e categoria do merchant. Vazamento de dados comerciais entre concorrentes. |

```typescript
// L24-37 — SEM filtro tenantId
const abandoned = await prisma.paymentIntent.findMany({
    where: {
        deviceId: { not: null },
        OR: [
            { status: 'EXPIRED' },
            { status: 'PENDING', updatedAt: { lt: cutOffTime } }
        ]
    },
    // ← MISSING: tenantId filter
});
```

### TENANT-002 🟠 ALTO — `VeraAgentController.executeRetargeting`: Ação de retargeting sem escopo de tenant

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/VeraAgentController.ts` |
| **Linhas**   | 67-101 |
| **Evidência** | Recebe `userId` no body e envia notificação sem verificar se o usuário pertence ao tenant do chamador. |
| **Risco**    | Um tenant malicioso pode enviar notificações para **usuários de outros tenants** se souber o userId. Sem validação de que o userId está no escopo do tenant autenticado. |

### TENANT-003 🟡 MÉDIO — `PublicAssetController.getPublicData`: Query sem escopo (intencional, mas sem rate limiting)

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/PublicAssetController.ts` |
| **Linhas**   | 23-51 |
| **Evidência** | Query `findFirst` sem filtro de tenant — busca por `id` ou `ntagUID` em todos os assets da plataforma. |
| **Risco**    | Sendo endpoint **público** (design intencional), o risco não é de autorização, mas de **enumeração**: sem rate limiting, um atacante pode enumerar todos os asset IDs e construir um mapa de assets da plataforma. |
| **Nota**     | Os dados retornados são sanitizados (LGPD-safe), então é mais um risco de intelligence gathering do que de privacy breach. |

### TENANT-004 🟡 MÉDIO — `ActivationMiddleware`: Query de asset sem filtro de tenant

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/middleware/ActivationMiddleware.ts` |
| **Linhas**   | 24-37 |
| **Evidência** | `prisma.asset.findFirst` busca por `ntagUID` ou `id` sem filtrar por tenant. |
| **Risco**    | Um vendedor de Tenant A pode potencialmente enviar um ntagUid de um asset do Tenant B, e o middleware retornará informações e injetará o asset no request. O controle de acesso depende de validações downstream. |

### TENANT-005 🟢 BAIXO — `AssetTransferController.resolvePlatformTenantId`: Cache estático sem invalidação

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/AssetTransferController.ts` |
| **Linhas**   | 18-42 |
| **Evidência** | `_platformTenantId` é cacheado em memória estática (`private static`) sem TTL nem invalidação. |
| **Risco**    | Se o platform tenant ID mudar (ex: migração, recriação), o cache só é limpo com restart do processo. Não é multi-tenancy issue per se, mas pode causar routing de receita para tenant errado. |

---

## Vetor 5 — Dívida Técnica Explícita (TODO/FIXME)

Marcadores deixados pelos desenvolvedores indicando funcionalidade incompleta.

### TD-001 🟠 ALTO — Método QTAG não implementado no checkout

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/controllers/PaymentLinkController.ts:169` |
| **Marcador** | `// TODO: Implementar SmartSpendService para pagamento com Saldo QTAG` |
| **Impact**   | Método de pagamento oferecido na UI mas retorna 501. |

### TD-002 🟡 MÉDIO — Upload IPFS não implementado

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/blockchain/AlgorandService.ts:205` |
| **Marcador** | `// TODO: Upload para IPFS e obter CID` |
| **Impact**   | Metadados ARC-69 podem não ter CID real para verificação descentralizada. |

### TD-003 🟡 MÉDIO — Notificações de relay não implementadas

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/core-facets/RelayFacet.ts:132-133` |
| **Marcador** | `// TODO: Integrar com serviço de email (SendGrid, SES, etc.)` / `// TODO: Integrar com push notification (Firebase, etc.)` |
| **Impact**   | Feature core (Blind Relay) registra dados mas nunca notifica proprietário. |

### TD-004 🟡 MÉDIO — Push notification na ativação ausente

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/middleware/ActivationMiddleware.ts:48` |
| **Marcador** | `// TODO: Disparar Push Notification/WebSocket aqui` |
| **Impact**   | Fluxo Just-in-Time depende do usuário descobrir que precisa ativar. |

### TD-005 🟡 MÉDIO — Status Check para polling de Push Auth ausente

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/routes/v1/paymentRoutes.ts:57` |
| **Marcador** | `// TODO: Status Check para Polling de Push Auth` |
| **Impact**   | Clientes não podem verificar status de pagamento por polling. |

### TD-006 🟢 BAIXO — Alertas de monitoramento (Sentry/Slack) não implementados

| Campo        | Valor |
|--------------|-------|
| **Arquivo**  | `src/services/billing/BillingService.ts:124` |
| **Marcador** | `// TODO: Send alert to monitoring (Sentry/Slack)` |
| **Impact**   | Log entries dropped após max retries sem alerta para equipe de ops. |

---

## 7. Matriz de Severidade Consolidada

### 🔴 CRÍTICOS (5) — Correção ANTES de produção

| ID         | Resumo | Tipo |
|------------|--------|------|
| ATOM-001   | `WalletController.credit`: crédito + comissão fora de $transaction, **método inexistente** (`processTripleSplit`) | Atomicidade + Runtime Crash |
| GAP-001    | **ZERO** lógica de estorno/refund/chargeback em todo o codebase | Fluxo Ausente |
| GAP-002    | `CommissionService.processTripleSplit` não existe → crash em runtime | Dead Code / API Contract |
| TENANT-001 | `VeraAgentController.getAbandonedCarts` expõe dados de TODOS os tenants | Data Leak |
| ERR-006    | Falcon verification failure → `signatureValid = true` (bypass de segurança PQC) | Security Bypass |

### 🟠 ALTOS (7) — Correção no Sprint 1

| ID         | Resumo | Tipo |
|------------|--------|------|
| GAP-003    | Saque PIX debita ledger mas **nunca envia dinheiro** ao banco (MOCK) | Fluxo Mock |
| GAP-004    | Pagamento QTAG retorna 501 no checkout (oferecido mas não funciona) | Feature Incompleta |
| ERR-001    | `apiKey.update` com `.catch(() => {})` — telemetria silenciada | Silent Error |
| ERR-002    | API Key resolution failure → request continua sem contexto B2B | Fail-Open |
| TENANT-002 | Retargeting sem escopo de tenant → notificação cross-tenant possível | Data Leak |
| TD-001     | TODO: SmartSpend no checkout QTAG (501 em produção) | Debt |

### 🟡 MÉDIOS (7) — Correção no Sprint 2

| ID         | Resumo | Tipo |
|------------|--------|------|
| ATOM-002   | `PaymentController.activate`: estado + paymentEnabled sem $transaction | Atomicidade |
| ATOM-003   | `OwnershipFacet` standalone: update + event sem $transaction | Atomicidade |
| GAP-005    | SoftPOS External Card: emvToken nunca enviado ao gateway | Feature Incompleta |
| GAP-006    | Relay notifications são console.log (sem email/push) | Feature Incompleta |
| GAP-007    | Activation push notification ausente | Feature Incompleta |
| ERR-003    | Email resolution silenciada no billing | Silent Error |
| TENANT-003 | PublicAssetController sem rate limiting contra enumeração | Hardening |

### 🟢 BAIXOS (6) — Backlog

| ID         | Resumo | Tipo |
|------------|--------|------|
| ATOM-004   | Expiração de PaymentLink sem lock (idempotente) | Minor Race |
| ERR-004    | ACR122U shutdown com catch vazio | Resource Leak |
| ERR-005    | Gateway error body silenciado (resiliência vs. debug) | Tradeoff |
| TENANT-004 | ActivationMiddleware query sem tenant filter | Hardening |
| TENANT-005 | Platform tenant ID cache sem invalidação | Cache |
| TD-006     | Alertas Sentry/Slack não implementados | Observability |

---

## 8. Recomendação de Priorização

### 🚨 Fase 0: Bloqueantes (Antes de QUALQUER deploy)

1. **ATOM-001 + GAP-002**: Corrigir chamada `processTripleSplit` → `distributeServiceFee` e wrapping em `$transaction`. Sem isso, **qualquer crédito com assetId derruba o servidor**.
2. **ERR-006**: Decidir política para Falcon unavailable — rejeitar ou adicionar flag `FALCON_OPTIONAL=true` em ENV. O bypass silencioso é inaceitável.
3. **TENANT-001**: Adicionar filtro `tenantId` na query do VERA ou restringir endpoint apenas a chamadas internas autenticadas como platform admin.

### 🔧 Fase 1: Financeiro (Sprint 1)

4. **GAP-001**: Implementar `LedgerService.processRefund()` com reversão atômica de entries + webhook handler para chargebacks.
5. **GAP-003**: Integrar PSP real para saques PIX (Mercado Pago Payouts ou similar) ou **bloquear endpoint** até integração.
6. **TENANT-002**: Validar que `userId` no retargeting pertence ao tenant do chamador.

### 🔨 Fase 2: Completude (Sprint 2)

7. Atomicidade: Wrapping de `PaymentController.activate` e `OwnershipFacet` standalone em `$transaction`.
8. Features: Integrar email para RelayFacet, push para ActivationMiddleware, SmartSpend no checkout.
9. Hardening: Rate limiting no PublicAssetController, tenant filter no ActivationMiddleware.

---

*Relatório gerado automaticamente por auditoria estática. Nenhum código foi alterado.*
