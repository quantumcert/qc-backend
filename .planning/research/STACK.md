# Stack Research

**Domain:** Backend SaaS multi-tenant — certificação de ativos físicos/digitais via ancoragem multi-chain com criptografia pós-quântica (Falcon-512)
**Researched:** 2026-05-08
**Confidence:** HIGH (stack existente confirmado via codebase; versões verificadas via npm/GitHub; áreas de expansão verificadas via WebSearch + fontes oficiais)

---

## Current Stack (Confirmed — Do Not Change)

O stack core está consolidado e em produção. As recomendações abaixo são aditivas — nenhuma substitui o que existe.

| Technology | Current Version | Status |
|------------|-----------------|--------|
| Node.js | 20 (Alpine Docker) | KEEP — LTS, Dokploy-compatible |
| TypeScript | ^5.3.3 | KEEP — strict mode, ES2022 |
| Express | ^4.18.2 | KEEP — veja nota sobre migração abaixo |
| Prisma | ^5.7.0 | UPGRADE to 6.x — ver seção abaixo |
| PostgreSQL | (via DATABASE_URL) | KEEP |
| Vitest | ^1.0.4 | KEEP |
| Zod | ^3.22.4 | KEEP |
| algosdk | ^3.5.2 | KEEP |
| falcon-crypto | ^1.0.6 | KEEP com caveat — ver seção PQC |
| node-cron | ^4.2.1 | KEEP para crons simples; NÃO escalar para filas |
| ethers | ^6.13.0 | KEEP |

---

## Recommended Stack — Expansão Production-Ready

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@stellar/stellar-sdk` | **^14.6.1** | Stellar/Soroban anchoring adapter | v14 é a versão estável atual (publicada ~25 dias atrás). O projeto está em ^12.0.0 — a diferença inclui remoção de `SorobanRpc` como import separado, renomeação de `ContractSpec` para `Spec`, e `AssembledTransaction.signAndSend()` com novo error type. **Upgrade obrigatório antes do hackathon Stellar.** |
| `@solana/web3.js` | **^1.95.0** (manter) | Solana anchoring adapter | v1.95 está em maintenance mode; o sucessor é `@solana/kit` (ex-web3.js v2). Para o adapter existente, **manter v1 agora** e migrar para `@solana/kit` em milestone separado. Migração v1→Kit é breaking em toda a API (classes→funções, `Connection`→`createSolanaRpc`, BigInt nativo). A bridge `@solana/web3-compat` existe para migração gradual. |
| `pino` | **^9.x** | Structured logging | `console.log` em produção não tem nível, não tem JSON serializável, não integra com log aggregators. Pino é 5-10x mais rápido que Winston, output JSON nativo, `pino-http` integra com Express sem wrapper. **Gap crítico para production-readiness.** |
| `pino-http` | **^10.x** | Express request logging middleware | Integração de pino com Express — log automático de req/res com duração, status code, e correlation IDs. |

### Supporting Libraries — Expansão

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bullmq` | **^5.x** | Job queue com persistência Redis | Usar para qualquer worker que **não pode perder jobs** entre restarts: `EscrowReleaseWorker`, retry de DLT com backoff exponencial, `BlockchainObserver`. O `node-cron` existente é adequado para crons simples (SchedulerService com 30s/60s intervals), mas não para jobs que precisam de retentativa, prioridade, ou deduplicação. |
| `ioredis` | **^5.x** | Redis client (dependência de BullMQ) | Necessário se BullMQ for adotado. Redis pode ser adicionado como serviço no Dokploy — o próprio Dokploy usa BullMQ + Redis internamente (v5.4.2). |
| `@oqs/liboqs-js` | **^0.x** (npm: liboqs-js) | Alternativa PQC com suporte oficial NIST | Usar apenas se `falcon-crypto` mostrar problemas de manutenção. Inclui Falcon-512, ML-DSA (Dilithium), ML-KEM. Wrapper JS/WASM do liboqs (Open Quantum Safe project). |
| `@sentry/node` | **^8.x** | Error tracking em produção | Gap atual: nenhum error tracking detectado. Sentry captura exceções não tratadas, DLT adapter failures, e erros de cron sem instrumentação manual. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | Hot-reload dev | Já presente (^4.7.0) — manter |
| `pino-pretty` | Legibilidade de logs em dev | Instalar como devDependency; NUNCA em produção (overhead + derrota o propósito do JSON) |
| `@types/node-cron` | Types para node-cron | Já presente (^3.0.11) — manter |

---

## Installation

```bash
# Upgrade Stellar SDK (CRÍTICO — hackathon priority)
npm install @stellar/stellar-sdk@^14.6.1

# Structured logging (production gap)
npm install pino pino-http
npm install -D pino-pretty

# Error tracking
npm install @sentry/node@^8

# BullMQ (apenas se decidir adotar job queue persistente)
npm install bullmq ioredis
```

---

## Decisions — Detalhe Técnico

### 1. `@stellar/stellar-sdk` — Upgrade de ^12 para ^14.6.1

**Confidence: HIGH** — Versão verificada via npm (publicada ~25 dias atrás).

Diferenças breaking de v12→v14 que afetam `SorobanAdapter.ts`:
- `SorobanRpc` não é mais um import separado — passou a fazer parte do namespace principal
- `ContractSpec` foi renomeado para `Spec`
- `SentTransaction` construtor mudou para 1 argumento
- `AssembledTransaction.signAndSend()` lança `SentTransaction.Errors.TransactionStillPending` em vez de silenciar

Ação: auditar `src/services/multi-chain/SorobanAdapter.ts` contra o changelog antes de upgrade. O mock em `__mocks__/@stellar/stellar-sdk.ts` também precisará de atualização.

### 2. `@solana/web3.js` — Manter ^1.95.0, planejar migração para `@solana/kit`

**Confidence: HIGH** — Confirmado via Anza/Solana Foundation blogs.

`@solana/kit` (anteriormente web3.js v2) é o futuro oficial, com 10x mais rápido em signing e bundle 30% menor. Porém:
- API completamente diferente (classes→funções, `Keypair`→`KeyPairSigner`, `PublicKey`→`address` string, `BigInt` nativo)
- Anchor ainda não suporta Kit out-of-the-box (relevante se o `SOLANA_ANCHOR_PROGRAM_ID` usar Anchor)
- Bridge `@solana/web3-compat` existe para migração gradual

**Recomendação:** Manter v1.95 no milestone atual. Criar milestone dedicado para migração para `@solana/kit` após o hackathon Stellar.

### 3. `node-cron` vs `BullMQ` — Critério de decisão

**Confidence: HIGH** — Alinhado com documentação oficial BullMQ e análises de produção.

| Critério | node-cron | BullMQ |
|----------|-----------|--------|
| Persistência entre restarts | NÃO — jobs perdidos se processo morrer | SIM — Redis persiste jobs |
| Retentativas automáticas | NÃO | SIM — backoff exponencial configurável |
| Monitoramento de jobs | NÃO | SIM — Bull Board / BullMQ Pro |
| Dependência adicional | nenhuma | Redis (serviço adicional) |
| Complexidade | baixa | média |
| Caso de uso ideal | health checks, aggregations, polling simples | DLT retries, escrow release, blockchain observer |

**Decisão para este projeto:**
- `node-cron` (existente): `SchedulerService` para `AnchorQueue` trigger (30s), `SecurityWatchdog` (60s) — jobs stateless que podem ser perdidos sem dano grave
- `BullMQ` (adicionar): `EscrowReleaseWorker` e DLT retry com backoff — estes jobs NÃO podem ser perdidos (consequência financeira/contratual)
- **Dokploy suporta Redis** — o próprio Dokploy usa BullMQ + Redis internamente, portanto não é nova dependência de infra conceitual

### 4. `falcon-crypto ^1.0.6` — Manter, mas monitorar

**Confidence: MEDIUM** — Verificado via npm e contexto do codebase. Alternativa liboqs verificada via Open Quantum Safe.

`falcon-crypto` é a biblioteca atual, funcional no projeto. O risco é de manutenção: é uma biblioteca menor, não o projeto Open Quantum Safe oficial.

Alternativa oficial: `@oqs/liboqs-js` do projeto Open Quantum Safe (suportado por Linux Foundation). Inclui Falcon-512, ML-DSA (Dilithium — padrão NIST recomendado para novos projetos), ML-KEM. A desvantagem é que é um wrapper WASM, mais pesado que um binding nativo.

**Recomendação:** Manter `falcon-crypto` até surgir um problema de manutenção documentado. Não migrar sem necessidade — o risco de regressão na assinatura PQC é alto. Monitorar releases do repo e avaliar `liboqs-js` quando houver milestone específico de PQC hardening.

### 5. `Prisma ^5.7.0` — Upgrade para ^6.x

**Confidence: HIGH** — Changelog oficial Prisma verificado.

Prisma 6 (GA) oferece:
- Melhor performance de query
- `TypedSql` — queries SQL type-safe sem raw queries
- Mínimo: TypeScript 5.1+ (projeto já está em 5.3.3 — compatível), Node.js 20+ (compatível)

Breaking changes relevantes:
- `Buffer` → `Uint8Array` para campos `Bytes` — verificar se schema tem campos Bytes
- Campos de relação implícita M-N mudam de unique index para primary key — requer migração `prisma migrate dev --name upgrade-to-v6`

**Recomendação:** Upgrade para Prisma 6 em milestone de Core Gap Closure. Não é urgente, mas vale antes de ir para produção plena.

### 6. Express ^4.18.2 — Manter, não migrar para Fastify

**Confidence: HIGH** — Comparação verificada via múltiplas fontes.

Fastify é 2-3x mais rápido em benchmarks. Porém:
- O projeto tem um sistema de middleware elaborado (Diamond proxy, requireApiKey, RBAC, idempotency) — todos Express-native
- Migração de Express para Fastify é reescrita completa de rotas e middlewares
- Para um backend de certificação (não real-time, não sub-100ms SLA), o throughput do Express é suficiente
- Express 5 (GA agora) traz async error handling nativo — upgrade menor vale quando estabilizar

**Não migrar para Fastify.** O custo é alto demais para o ganho de performance que não é o gargalo do sistema (o gargalo é DLT latência, não HTTP throughput).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@stellar/stellar-sdk ^14` | Manter ^12 | Nunca — ^12 tem APIs deprecated que afetam Soroban RPC |
| `node-cron` (manter) | `Agenda` (Mongo-backed) | Nunca — projeto não usa MongoDB; complexidade desnecessária |
| `BullMQ` (adicionar seletivamente) | `pg-boss` (Postgres-backed queue) | Se quiser evitar Redis completamente — `pg-boss` usa PostgreSQL como broker. Válido, mas BullMQ tem ecossistema maior e Dokploy já suporta Redis. |
| `pino` | `Winston` | Se precisar de transports complexos out-of-the-box (file rotation, etc). Winston é mais configurável mas ~5x mais lento. Para JSON→log aggregator, pino é superior. |
| `@solana/web3.js ^1.95` (manter) | `@solana/kit` (migrar agora) | Migrar para Kit em milestone dedicado pós-hackathon. Não agora — risco de regressão no adapter existente. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `Agenda` | Mongo-backed — adiciona MongoDB como dependência sem benefício; projeto já tem Postgres | `BullMQ` (Redis) ou `pg-boss` (Postgres) |
| `node-schedule` | Wrapper de cron sem persistência, mesmos limites do node-cron mas com menos stars/manutenção | `node-cron` (simples) ou `BullMQ` (persistente) |
| `Winston` para logging de produção | 5-10x mais lento que Pino, sem JSON nativo sem configuração extra | `pino` + `pino-http` |
| `@stellar/stellar-sdk ^12` (manter) | APIs deprecated, `SorobanRpc` como import separado foi removido em versões posteriores | `^14.6.1` |
| `@solana/kit` agora (upgrade imediato) | Breaking total com v1.95 — Anchor não suporta kit out-of-the-box, risco de regressão | Migrar em milestone dedicado com `@solana/web3-compat` como bridge |
| `console.log` em produção | Sem levels, sem JSON serializável, sem correlation IDs, sem integração com log aggregators | `pino` |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@stellar/stellar-sdk ^14.6.1` | Node.js 20, TypeScript 5.x | Breaking vs ^12 — auditar SorobanAdapter.ts antes de upgrade |
| `bullmq ^5.x` | `ioredis ^5.x`, Redis >= 2.8.18 | BullMQ 5.x requer ioredis 5 — não instalar redis (cliente antigo) |
| `pino ^9.x` | Express ^4, Node.js 20 | `pino-http ^10` para Express integration |
| `prisma ^6.x` | TypeScript ^5.1, Node.js 20 | Requer `prisma migrate dev --name upgrade-to-v6` para M-N relations |
| `@sentry/node ^8.x` | Node.js 20, Express ^4 | OpenTelemetry-based em v8 — instrumentação automática de Express |

---

## Stack Patterns — Condicionais

**Se job precisar de garantia de entrega (EscrowRelease, DLT retry com backoff):**
- Usar BullMQ com Redis
- Configurar `attempts: 5, backoff: { type: 'exponential', delay: 2000 }`
- Adicionar Bull Board para visibilidade de jobs em produção

**Se job for stateless e perda ocasional for aceitável (security watchdog, health aggregation):**
- Manter node-cron
- Sem dependência adicional de Redis

**Se precisar de logging com correlation ID por request:**
- Usar `pino-http` com `genReqId` customizado
- Propagar `req.id` para todos os logs dentro do request lifecycle

**Se Anchor for usado no Solana adapter:**
- Manter `@solana/web3.js ^1.95` — Kit não suporta Anchor out-of-the-box ainda
- Reavaliar quando `@coral-xyz/anchor` suportar Kit nativamente

---

## Sources

- npm registry — `@stellar/stellar-sdk` latest: 14.6.1 (publicado ~25 dias atrás) — HIGH confidence
- [Stellar SDK CHANGELOG](https://github.com/stellar/js-stellar-sdk/blob/master/CHANGELOG.md) — breaking changes v12→v14 — HIGH confidence
- [Anza blog — @solana/kit release](https://www.anza.xyz/blog/solana-web3-js-2-release) — Kit como sucessor oficial de web3.js v1 — HIGH confidence
- [Helius — Building with web3.js 2.0](https://www.helius.dev/blog/how-to-start-building-with-the-solana-web3-js-2-0-sdk) — migração v1→Kit — HIGH confidence
- [BullMQ docs — Going to production](https://docs.bullmq.io/guide/going-to-production) — persistência Redis, retentativas — HIGH confidence
- [BetterStack — BullMQ scheduled tasks](https://betterstack.com/community/guides/scaling-nodejs/bullmq-scheduled-tasks/) — comparação com node-cron — MEDIUM confidence
- [Open Quantum Safe — Falcon](https://openquantumsafe.org/liboqs/algorithms/sig/falcon.html) — liboqs como alternativa oficial — HIGH confidence
- [Prisma 6 upgrade guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-6) — breaking changes documentados — HIGH confidence
- [Pino docs — pino-http](https://last9.io/blog/npm-pino-logger/) — Express integration — MEDIUM confidence
- Codebase audit (`package.json`, `src/`) — versões exatas e uso real confirmados — HIGH confidence

---

*Stack research for: qc-backend — multi-tenant blockchain certification backend*
*Researched: 2026-05-08*
