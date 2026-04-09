# 💰 Quantum Cert — Tabela de Precificação Oficial
## Documento Comercial v1.0 — Vigência: Fevereiro 2026

---

> **Classificação:** Interno / Comercial  
> **Última actualização:** 17 de Fevereiro de 2026  
> **Responsável:** Equipa Quantum Cert  
> **Fonte da verdade:** `src/seeds/seed-billing.ts` + `prisma/schema.prisma`  
> **Moeda base:** BRL (Real Brasileiro) — valores em centavos no sistema interno

---

## 📋 Índice

1. [Visão Geral do Modelo de Negócio](#1-visão-geral-do-modelo-de-negócio)
2. [Facetas Cobráveis (Operações)](#2-facetas-cobráveis-operações)
3. [Planos Disponíveis](#3-planos-disponíveis)
4. [Tabela Comparativa](#4-tabela-comparativa)
5. [Exemplos de Orçamento](#5-exemplos-de-orçamento)
6. [Política de Cobrança](#6-política-de-cobrança)
7. [Glossário Técnico-Comercial](#7-glossário-técnico-comercial)
8. [Notas para Equipa de Vendas](#8-notas-para-equipa-de-vendas)

---

## 1. Visão Geral do Modelo de Negócio

A Quantum Cert utiliza um modelo **Pay-per-Operation** (pagamento por operação) combinado com **planos de subscrição** para clientes corporativos.

### Dois Modos de Cobrança

| Modo | Público Alvo | Quando Paga | Método |
|------|-------------|-------------|--------|
| **PREPAID (Pré-pago)** | B2C — Pessoas físicas, freelancers, PMEs | **Antes** de cada operação | PIX (QR Code Mercado Pago) ou Checkout Pro |
| **POSTPAID (Pós-pago)** | B2B — Empresas com contrato | **Fatura mensal** consolidada | Boleto/Transferência |

### Arquitectura de Preços

```
BillingPlan → define preço por Faceta
           → cada operação (Mint, Transfer, State, Event, Tag) tem preço independente
           → preço em centavos BRL (inteiros, sem floating point)
           → ex: 4999 = R$ 49,99
```

---

## 2. Facetas Cobráveis (Operações)

Cada operação no Quantum Cert corresponde a uma **Faceta** do sistema. As Facetas são agnósticas ao domínio — o preço é o mesmo independentemente do tipo de ativo (bicicleta, título financeiro, identidade, etc.).

| Faceta | Operação | Endpoint API | O que Inclui |
|--------|---------|-------------|--------------|
| **MINT** | Criar ativo digital | `POST /api/v1/assets` | Gera hash Falcon-512 + Cria ARC-89 Registry na Algorand + Ancora Note Field imutável + Persiste no PostgreSQL |
| **TRANSFER** | Transferir titularidade | `POST /api/v1/assets/:id/transfer` | Valida ownership + Verifica Soulbound + Ancora on-chain + Actualiza owner |
| **STATE** | Mudar estado do ativo | `POST /api/v1/assets/:id/state` | Transição de estado (ACTIVE↔ALERT↔FROZEN→RETIRED) + Registo on-chain |
| **EVENT** | Injectar evento | `POST /api/v1/assets/:id/events` | Registo imutável de evento (manutenção, furto, etc.) + Prova on-chain |
| **TAG** | Gravar NFC QTAG | `POST /api/v1/assets/:id/tag` | Derivar DAT + Preparar layout NTAG 424 DNA (144 bytes) + Gravação física |

### Custo Operacional por Faceta

Cada operação tem custos de infraestrutura que justificam os preços:

| Faceta | Custos de Infraestrutura |
|--------|------------------------|
| **MINT** | Falcon-512 (CPU-intensivo) + Algorand ASA creation (1 txn) + Algorand Note (1 txn) + DB write |
| **TRANSFER** | Algorand Note (1 txn) + DB update |
| **STATE** | Algorand Note (1 txn) + DB update |
| **EVENT** | Algorand Note (1 txn) + DB write |
| **TAG** | HKDF-SHA3-256 derivation + NFC write (NTAG 424 DNA chip cost not included) |

---

## 3. Planos Disponíveis

### 3.1 🆓 FREE_TRIAL — Plano de Teste Gratuito

> **Para:** Avaliação do produto, demonstrações, POCs

| Item | Valor |
|------|-------|
| **Modo** | PREPAID (mas R$ 0,00) |
| **Duração** | 30 dias |
| **Mint** | **Grátis** (limite: 50/mês) |
| **Transfer** | **Grátis** (limite: 10/mês) |
| **State** | **Grátis** |
| **Event** | **Grátis** |
| **Tag** | **Grátis** |
| **Limites** | 50 mints/mês + 10 transfers/mês |
| **Suporte** | Documentação online |

---

### 3.2 👤 B2C_DEFAULT — Plano Padrão Individual

> **Para:** Pessoas físicas, freelancers, pequenos negócios sem contrato

| Item | Valor |
|------|-------|
| **Modo** | PREPAID (paga antes de cada operação) |
| **Pagamento** | PIX (QR Code automático) ou Checkout Mercado Pago |
| **Mint** | **Grátis** (R$ 0,00) |
| **Transfer** | **R$ 49,99** por transferência |
| **State** | **Grátis** (R$ 0,00) |
| **Event** | **Grátis** (R$ 0,00) |
| **Tag (QTAG NFC)** | **R$ 9,99** por gravação |
| **Limites** | Ilimitado |
| **Suporte** | Documentação online + Email |

**Valores no sistema (centavos):**
```
mintPrice:     0       → R$ 0,00
transferPrice: 4999    → R$ 49,99
statePrice:    0       → R$ 0,00
eventPrice:    0       → R$ 0,00
tagPrice:      999     → R$ 9,99
```

**Cenário típico:** Proprietário individual registra sua bicicleta (Mint grátis), depois transfere para outro proprietário (R$ 49,99), grava QTAG NFC (R$ 9,99).

---

### 3.3 🚀 B2B_STARTUP — Plano Startup / PME

> **Para:** Startups, PMEs, e-commerces com até ~1.000 operações/mês

| Item | Valor |
|------|-------|
| **Modo** | POSTPAID (fatura mensal consolidada) |
| **Mint** | **Grátis** (R$ 0,00) — limite: 1.000/mês |
| **Transfer** | **R$ 0,10** por transferência |
| **State** | **Grátis** (R$ 0,00) |
| **Event** | **Grátis** (R$ 0,00) |
| **Tag (QTAG NFC)** | **Grátis** (R$ 0,00) |
| **Limites** | 1.000 mints/mês, transfers ilimitados |
| **API Keys** | Incluídas |
| **Suporte** | Email + Slack |

**Valores no sistema (centavos):**
```
mintPrice:         0       → R$ 0,00
transferPrice:     10      → R$ 0,10
statePrice:        0       → R$ 0,00
eventPrice:        0       → R$ 0,00
tagPrice:          0       → R$ 0,00
monthlyMintLimit:  1000
```

**Cenário típico:** E-commerce que registra 500 produtos/mês (Mint grátis) e precisa de ~200 transferências para vendas (R$ 0,10 × 200 = R$ 20,00/mês).

---

### 3.4 📈 B2B_SCALE — Plano Escala

> **Para:** Operações de média e grande escala, marketplaces, seguradoras

| Item | Valor |
|------|-------|
| **Modo** | POSTPAID (fatura mensal consolidada) |
| **Mint** | **Grátis** (R$ 0,00) — ilimitado |
| **Transfer** | **R$ 0,05** por transferência |
| **State** | **Grátis** (R$ 0,00) |
| **Event** | **Grátis** (R$ 0,00) |
| **Tag (QTAG NFC)** | **Grátis** (R$ 0,00) |
| **Limites** | Sem limites |
| **API Keys** | Incluídas |
| **Suporte** | Prioritário + SLA |

**Valores no sistema (centavos):**
```
mintPrice:         0       → R$ 0,00
transferPrice:     5       → R$ 0,05
statePrice:        0       → R$ 0,00
eventPrice:        0       → R$ 0,00
tagPrice:          0       → R$ 0,00
monthlyMintLimit:  null    → ilimitado
```

**Cenário típico:** Marketplace de bicicletas com 10.000 transferências/mês (R$ 0,05 × 10.000 = R$ 500,00/mês).

---

### 3.5 🏢 ENTERPRISE — Enterprise Custom

> **Para:** Bancos, governos, grandes corporações com necessidades específicas

| Item | Valor |
|------|-------|
| **Modo** | POSTPAID (contrato customizado) |
| **Todas as Facetas** | **R$ 0,00** (pricing via contrato separado) |
| **Limites** | Sem limites |
| **API Keys** | Ilimitadas |
| **SLA** | Customizado |
| **Suporte** | Dedicado + Account Manager |
| **Infra** | Possibilidade de on-premise / VPC dedicada |

**Notas:**
- O preço R$ 0,00 no sistema não significa gratuito — o contrato enterprise define valores fixos mensais ou anuais.
- Os valores são zerados no BillingPlan porque a faturação é feita externamente (ERP/contrato).
- Suporte a SLA de 99,9%+ de uptime.
- White-label disponível.

---

## 4. Tabela Comparativa

| | FREE_TRIAL | B2C_DEFAULT | B2B_STARTUP | B2B_SCALE | ENTERPRISE |
|---|:---:|:---:|:---:|:---:|:---:|
| **Modo** | Prepaid | Prepaid | Postpaid | Postpaid | Postpaid |
| **Mint** | R$ 0 | R$ 0 | R$ 0 | R$ 0 | Contrato |
| **Transfer** | R$ 0 | **R$ 49,99** | **R$ 0,10** | **R$ 0,05** | Contrato |
| **State** | R$ 0 | R$ 0 | R$ 0 | R$ 0 | Contrato |
| **Event** | R$ 0 | R$ 0 | R$ 0 | R$ 0 | Contrato |
| **Tag (NFC)** | R$ 0 | **R$ 9,99** | R$ 0 | R$ 0 | Contrato |
| **Mints/mês** | 50 | ∞ | 1.000 | ∞ | ∞ |
| **Transfers/mês** | 10 | ∞ | ∞ | ∞ | ∞ |
| **API Keys** | ✗ | ✗ | ✓ | ✓ | ✓ |
| **Pagamento** | — | PIX/MP | Fatura | Fatura | Contrato |
| **Suporte** | Docs | Email | Slack | SLA | Dedicado |

---

## 5. Exemplos de Orçamento

### 5.1 Orçamento — Loja de Bicicletas (B2B_STARTUP)

```
Quantidade estimada mensal:
  Mints (registro de bikes novas):     300 × R$ 0,00  =  R$    0,00
  Transfers (vendas):                  150 × R$ 0,10  =  R$   15,00
  State Changes (recalls/alertas):      10 × R$ 0,00  =  R$    0,00
  Events (manutenção/revisões):         80 × R$ 0,00  =  R$    0,00
  Tags NFC (gravação QTAG):           100 × R$ 0,00  =  R$    0,00
                                                      ─────────────
  TOTAL MENSAL ESTIMADO:                                R$   15,00
  TOTAL ANUAL ESTIMADO:                                 R$  180,00
```

### 5.2 Orçamento — Marketplace de Veículos (B2B_SCALE)

```
Quantidade estimada mensal:
  Mints (registro de veículos):       5.000 × R$ 0,00  =  R$     0,00
  Transfers (vendas/revendas):       10.000 × R$ 0,05  =  R$   500,00
  State Changes (bloqueio judicial):    200 × R$ 0,00  =  R$     0,00
  Events (vistoria, sinistro):        2.000 × R$ 0,00  =  R$     0,00
  Tags NFC (placas QTAG):            1.000 × R$ 0,00  =  R$     0,00
                                                        ─────────────
  TOTAL MENSAL ESTIMADO:                                  R$   500,00
  TOTAL ANUAL ESTIMADO:                                   R$ 6.000,00
```

### 5.3 Orçamento — Proprietário Individual (B2C_DEFAULT)

```
Operação única:
  Mint (registrar bicicleta):           1 × R$  0,00  =  R$  0,00
  Tag NFC (gravar QTAG):               1 × R$  9,99  =  R$  9,99
                                                       ──────────
  TOTAL (ÚNICO):                                        R$  9,99

Eventualmente:
  Transfer (vender bicicleta):          1 × R$ 49,99  =  R$ 49,99
```

### 5.4 Orçamento — Seguradora Nacional (ENTERPRISE)

```
Quantidade estimada mensal:
  Mints (apólices + veículos):       50.000 × Contrato
  Transfers (sinistros/cessões):     20.000 × Contrato
  State Changes:                      5.000 × Contrato
  Events (vistorias, laudos):        30.000 × Contrato

  Proposta sugerida:
    Fee mensal fixa:                         R$ 5.000,00
    — OU —
    Fee anual com desconto:                  R$ 50.000,00 (17% off)
    — OU —
    Por operação negociada:                  R$ 0,02/operação

  IMPORTANTE: Valores enterprise são negociados caso a caso.
  Os valores acima são sugestões iniciais para discussão.
```

---

## 6. Política de Cobrança

### 6.1 Regra FAIL-CLOSED (Inegociável)

```
⚠️  SE o sistema de billing falhar → A OPERAÇÃO É BLOQUEADA (nunca liberada).
⚠️  A integridade da receita é prioridade sobre a disponibilidade do serviço.
```

| Cenário | Comportamento |
|---------|--------------|
| B2C sem pagamento confirmado | **402 Payment Required** + QR Code PIX |
| B2C com erro no Mercado Pago | **500** — operação bloqueada |
| B2B com falha no log de uso | Retry 3× → Fila in-memory → Se fila cheia: **503** |
| Qualquer erro inesperado | **500** — nunca libera sem registo |

### 6.2 Métodos de Pagamento (B2C)

| Método | Provider | Tempo de Confirmação |
|--------|----------|---------------------|
| **PIX** | Mercado Pago | Instantâneo (~3s) |
| **Cartão de Crédito** | Mercado Pago (Checkout Pro) | Instantâneo |
| **Boleto** | Mercado Pago (Checkout Pro) | 1–3 dias úteis |

### 6.3 Faturação B2B

- Período de faturação: **mensal** (dia 1 a último dia do mês).
- Relatório de uso disponível via `GET /api/v1/billing/usage`.
- Fatura emitida até o **5º dia útil** do mês seguinte.
- Pagamento via **boleto bancário** ou **transferência bancária**.

---

## 7. Glossário Técnico-Comercial

| Termo | Significado |
|-------|-------------|
| **Faceta** | Uma operação atómica do sistema (Mint, Transfer, State, Event, Tag) |
| **Mint** | Criação de um ativo digital com hash Falcon-512 e registo na blockchain Algorand |
| **Transfer** | Transferência de titularidade de um ativo para outro proprietário |
| **State** | Mudança de estado do ciclo de vida (ACTIVE, ALERT, FROZEN, RETIRED) |
| **Event** | Registo imutável de um acontecimento associado ao ativo |
| **Tag (QTAG)** | Gravação de dados criptográficos num chip NFC NTAG 424 DNA |
| **Soulbound** | Ativo intransferível vinculado permanentemente a uma identidade |
| **Falcon-512** | Algoritmo de assinatura digital pós-quântico (NIST PQC Standard) |
| **ARC-89** | Padrão de metadata registry na blockchain Algorand |
| **DAT** | Derived Authentication Token — token derivado via HKDF-SHA3-256 |
| **NTAG 424 DNA** | Chip NFC da NXP com criptografia AES-128 e autenticação SUN |
| **ACR122U** | Leitor NFC USB da ACS para gravação de tags NTAG 424 DNA |
| **PREPAID** | Pagamento antes da operação (B2C — via PIX/Mercado Pago) |
| **POSTPAID** | Fatura mensal consolidada após as operações (B2B — via contrato) |
| **FAIL-CLOSED** | Se o billing falhar, a operação é bloqueada (nunca liberada sem pagamento) |

---

## 8. Notas para Equipa de Vendas

### O que incluir numa proposta comercial:

1. **Identificar o perfil do cliente:**
   - Pessoa física → B2C_DEFAULT (cobrar por operação)
   - Startup/PME (< 1.000 ops/mês) → B2B_STARTUP
   - Médio/grande porte (> 1.000 ops/mês) → B2B_SCALE
   - Enterprise (> 50.000 ops/mês ou requisitos especiais) → ENTERPRISE

2. **Estimar volume mensal por faceta:**
   - Quantos **mints** (registos novos)?
   - Quantas **transferências** (vendas, cessões)?
   - Quantos **events** (manutenção, vistorias)?
   - Quantas **tags NFC** (gravações QTAG)?

3. **Calcular custo mensal estimado:**
   - Multiplicar volume × preço unitário do plano
   - Incluir custos de hardware NFC se aplicável (NTAG 424 DNA + ACR122U)

4. **Diferenciais para destacar:**
   - ✅ Criptografia pós-quântica (Falcon-512) — preparado para computação quântica
   - ✅ Registo imutável na blockchain Algorand — prova criptográfica auditável
   - ✅ LGPD compliant — dados pessoais nunca expostos publicamente
   - ✅ Identidades Soulbound — impossível falsificar ou transferir indevidamente
   - ✅ NFC hardware-level security — NTAG 424 DNA com criptografia AES-128
   - ✅ Modelo pay-per-use — sem compromisso mensal no B2C

### Custos de Hardware (referência, não inclusos nos planos):

| Item | Custo Estimado | Observação |
|------|---------------|------------|
| NTAG 424 DNA (chip NFC) | ~R$ 5–15/unidade | Depende do formato e volume |
| ACR122U (leitor USB) | ~R$ 150–250/unidade | Um por estação de gravação |
| Cartão NFC personalizado | ~R$ 8–20/unidade | Com logo/design customizado |
| Pulseira NFC | ~R$ 12–30/unidade | Para pets/identidade |

---

## 📎 Referências Internas

| Recurso | Caminho |
|---------|---------|
| Seed dos planos | `src/seeds/seed-billing.ts` |
| Schema do BillingPlan | `prisma/schema.prisma` (model BillingPlan) |
| Serviço de Billing | `src/services/billing/BillingService.ts` |
| Serviço Mercado Pago | `src/services/billing/MercadoPagoService.ts` |
| Middleware FAIL-CLOSED | `src/middleware/billingMiddleware.ts` |
| Rotas de Billing | `src/routes/v1/billingRoutes.ts` |
| Fluxo QTAG físico | `docs/technical/FLUXO_QTAG_COMPLETO.md` |

---

**Documento criado em:** 17/02/2026  
**Versão:** 1.0  
**Equivalência no código:** `seed-billing.ts` v1 + `BillingService.ts` FAIL-CLOSED  
**Autor:** Equipa Quantum Cert  
**Próxima revisão:** Quando houver alteração de preços ou novos planos
