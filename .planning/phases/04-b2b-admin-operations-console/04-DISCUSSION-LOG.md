# Phase 4: B2B Admin Operations Console - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 04-b2b-admin-operations-console
**Areas discussed:** admin permissions, tenant activation, API keys, credits, receivables, QTAG fulfillment, request audit, admin UX, backfill

---

## Permissoes entre Quantum e tenants B2B

| Option | Description | Selected |
|--------|-------------|----------|
| Quantum forte | Quantum controla cadastro, ativacao, suspensao, concessoes criticas e auditoria; tenant opera so o proprio espaco. | Yes |
| Tenant autonomo | Tenant faz quase tudo dentro dos proprios limites. | |
| Misto aprovado | Tenant solicita acoes sensiveis e Quantum aprova em fila operacional. | |

**User's choice:** 1A  
**Notes:** Platform Admin Quantum deve ser o operador forte inicial.

---

## Ativacao de novo cliente B2B

| Option | Description | Selected |
|--------|-------------|----------|
| Manual aprovado | Quantum cria/revisa tenant, aprova plano/contrato e so entao ativa API keys e operacao. | Yes |
| Self-service | Cliente cria conta e recebe acesso apos validacoes minimas/pagamento. | |
| Convite vendas | Quantum inicia cadastro e convida o admin do cliente para completar dados antes da ativacao. | |

**User's choice:** 2A  
**Notes:** Ativacao B2B deve ser controlada por Quantum.

---

## Politica inicial de API keys

| Option | Description | Selected |
|--------|-------------|----------|
| Quantum emite | Platform Admin gera, rotaciona e revoga; Tenant Admin apenas visualiza status e solicita rotacao. | Yes |
| Tenant gerencia | Tenant Admin cria, rotaciona e revoga diretamente com limites e auditoria. | |
| Hibrido | Tenant Admin gerencia chaves de baixo risco; producao/escopos sensiveis exigem aprovacao Quantum. | |

**User's choice:** 3A  
**Notes:** A primeira chave deve ser cadastrada por Quantum. Admin tambem deve verificar chaves ativas e auditar requisicoes feitas pelo tenant.

---

## Modelo de creditos

| Option | Description | Selected |
|--------|-------------|----------|
| Ledger completo | Entradas `PURCHASED`, `GRANTED`, `ADJUSTED`, `REVOKED/REFUNDED`, sempre auditaveis por tenant. | |
| Saldo simples | Apenas contador de creditos disponivel/consumido, com historico basico. | |
| Wallet tokenizada | Creditos ligados diretamente a saldo on-chain/tokenizado. | |
| Ledger + projecao tokenizada futura | Ledger interno auditavel como fonte de verdade; token/on-chain pode espelhar/provar/liquidar futuramente sem custodia direta. | Yes |

**User's choice:** Usuario ficou entre A e C; decisao consolidada como misto A+C.  
**Notes:** Ledger operacional e obrigatorio agora; tokenizacao/on-chain futura nao substitui o ledger nem cria custodia direta.

---

## Transfero e recebimentos

| Option | Description | Selected |
|--------|-------------|----------|
| Provider boundary agora | Criar modelo generico `PaymentProvider`/`PaymentIntent`/`PaymentEvent`, com Transfero como candidata TBD. | Yes |
| Manual primeiro | Quantum lanca compras/creditos manualmente no admin; integracao Transfero fica para fase futura. | |
| Hibrido | Admin manual funcionando, mas ja com tabelas/eventos preparados para plugar Transfero depois. | |

**User's choice:** 5A  
**Notes:** Transfero segue como candidata preferencial, mas contrato final fica a definir.

---

## Uso de credito por operacao

| Option | Description | Selected |
|--------|-------------|----------|
| Debitar no sucesso | Debitar credito apenas quando a operacao principal for confirmada com sucesso. | |
| Reservar e liberar | Reservar credito no inicio e liberar em falha/cancelamento. | Yes |
| Debitar no pedido | Debitar no pedido, mesmo antes de confirmacao operacional. | |

**User's choice:** 6B  
**Notes:** Reserva no inicio; liberacao em falha/cancelamento; consumo definitivo depois do sucesso.

---

## QTAG: saldo, reserva e consumo

| Option | Description | Selected |
|--------|-------------|----------|
| Compra aumenta saldo; Asset reserva; ativacao consome | Comprar QTAG aumenta saldo disponivel; escolher Asset reserva; ativar apos gravacao fisica consome definitivamente. | Yes |
| Asset ja consome | Comprar QTAG aumenta saldo; escolher Asset ja consome; falha exige ajuste manual. | |
| Pedido direto | Comprar QTAG gera pedido direto; nao existe saldo reutilizavel de QTAG. | |

**User's choice:** 7A  
**Notes:** QTAG fica vinculada a Asset e so ativa apos commissioning fisico.

---

## Auditoria de requisicoes de API por tenant

| Option | Description | Selected |
|--------|-------------|----------|
| Logar toda requisicao autenticada | Tenant, key fingerprint, endpoint, status, latencia, correlation id e erro sanitizado; nunca segredo/body sensivel. | Yes |
| Logar apenas mutacoes/eventos | Reduz volume registrando somente operacoes importantes. | |
| Logar falhas/admin | Registra somente falhas e operacoes administrativas. | |

**User's choice:** 8A  
**Notes:** Auditoria completa de API calls por tenant e API key e requisito operacional.

---

## Interface operacional do admin

| Option | Description | Selected |
|--------|-------------|----------|
| Tenant detail como hub | Abas para status/plano, usuarios, API keys, creditos, compras, QTAGs, requisicoes e auditoria; filas separadas para ativacoes, pagamentos e QTAG. | Yes |
| Modulos globais separados | Admin separado por modulos globais, sem tela central forte por tenant. | |
| Listas simples primeiro | Comecar so com listas simples e evoluir depois. | |

**User's choice:** 9A  
**Notes:** Tenant detail deve ser cockpit central; filas separadas atendem trabalho operacional diario.

---

## Backfill e Tenant Quantum

| Option | Description | Selected |
|--------|-------------|----------|
| Estrutura e dry-run | Criar/garantir Tenant Quantum, mapear usuarios/assets existentes e gerar relatorio; execucao completa fica para fase propria. | |
| Executar backfill completo | Criar Tenant Quantum e executar migracao/associacao completa nesta fase 4. | Yes |
| Apenas documentar dependencia | Sem schema/script agora. | |

**User's choice:** 10B  
**Notes:** Esta escolha altera a fronteira anterior da Phase 5. Contexto registra que planejamento deve alinhar SPEC/roadmap ou absorver explicitamente backfill completo na Phase 4.

---

## the agent's Discretion

- Nomes finais de modelos, selectors, rotas e componentes.
- Estrategia tecnica de retencao/volume de audit logs.
- Granularidade exata de scopes de API key e limites por plano.

## Deferred Ideas

- Extrair `qc-admin` como app separado.
- Integracao final Transfero/provider.
- Tokenizacao/on-chain de creditos como camada futura.
