---
status: resolved
trigger: "Deploy automatizado no Dokploy reinicia containers; Prisma db push/generate falha com EACCES e servidor falha por env vars ausentes."
created: 2026-05-09T04:50:00Z
updated: 2026-05-09T05:06:00Z
---

# Debug Session — dokploy-prisma-generate-eacces

## Symptoms

expected_behavior: "Deploy no Dokploy sincroniza schema Prisma e inicia o servidor sem loop de restart."
actual_behavior: "Container reinicia; Prisma tenta gerar client e falha, depois o servidor aborta por variáveis obrigatórias ausentes."
error_messages: |
  Prisma schema loaded from prisma/schema.prisma
  Datasource "db": PostgreSQL database "quantum-cert-prod", schema "public" at "quantum-cert-database-6eidft:5432"
  The database is already in sync with the Prisma schema.
  Running generate... - Prisma Client
  EACCES: permission denied, unlink '/app/node_modules/.prisma/client/index.js'
  [FATAL ERROR] Failed to start Quantum Cert Core Engine.
  Missing required environment variables: MP_ACCESS_TOKEN, CIRCUIT_BREAKER_ADMIN_PUBKEY
  Production deployment requires strict definition of all endpoints and secrets.
timeline: "Iniciou após merge/deploy da Fase 1, que endureceu validação de ambiente em produção."
reproduction: "Executar deploy automatizado no Dokploy com comando de startup/predeploy que roda prisma db push antes de iniciar o app."

## Current Focus

hypothesis: "O comando de deploy roda `prisma db push` em runtime como usuário `node`; o Dockerfile cria o Prisma Client como root durante build, então `prisma generate` não consegue sobrescrever `/app/node_modules/.prisma/client/index.js`. Depois disso, o fail-fast de produção bloqueia startup por secrets realmente ausentes."
test: "Inspecionar Dockerfile, package scripts, server.ts e documentação/env example."
expecting: "Dockerfile deve gerar node_modules/.prisma como root e trocar para USER node antes do runtime; server.ts deve exigir MP_ACCESS_TOKEN e CIRCUIT_BREAKER_ADMIN_PUBKEY em produção."
next_action: "Abrir PR com correção de deploy Dokploy."

## Evidence

- timestamp: 2026-05-09T04:50:00Z
  source: user_log
  detail: "`prisma db push` informa schema sincronizado e em seguida tenta `Running generate... - Prisma Client`, falhando em `unlink '/app/node_modules/.prisma/client/index.js'` com EACCES."
- timestamp: 2026-05-09T04:50:00Z
  source: Dockerfile
  detail: "Runner executa `npm ci --omit=dev` e `npx prisma generate` como root, depois troca para `USER node`."
- timestamp: 2026-05-09T04:50:00Z
  source: src/server.ts
  detail: "Em `NODE_ENV=production`, `REQUIRED_ENV_VARS` inclui `QUANTUM_CERT_SECRET`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `CIRCUIT_BREAKER_ADMIN_PUBKEY`."
- timestamp: 2026-05-09T04:50:00Z
  source: .env.example
  detail: "`CIRCUIT_BREAKER_ADMIN_PUBKEY` e `MP_WEBHOOK_SECRET` estão documentados, mas `MP_ACCESS_TOKEN` ainda não aparece no exemplo."

## Eliminated

- hypothesis: "Banco fora de sync causa restart."
  reason: "Log informa explicitamente: `The database is already in sync with the Prisma schema`."
- hypothesis: "Erro fatal de env vars é falso positivo."
  reason: "Servidor exige essas variáveis em produção por desenho de segurança da Fase 1."

## Resolution

root_cause: "Deploy Dokploy executa `prisma db push` em runtime; esse comando roda `prisma generate` por padrão. O Dockerfile gerava `/app/node_modules/.prisma/client` como root e depois executava o container como `node`, causando EACCES ao tentar sobrescrever o client. Em seguida, o fail-fast de produção abortava corretamente por `MP_ACCESS_TOKEN` e `CIRCUIT_BREAKER_ADMIN_PUBKEY` ausentes."
fix: "Dockerfile agora faz `chown -R node:node /app`; package.json ganhou `db:push:deploy` com `prisma db push --skip-generate`; `.env.example` documenta `MP_ACCESS_TOKEN`; `docs/technical/DOKPLOY_DEPLOYMENT.md` documenta comando Dokploy e variáveis obrigatórias."
verification: "`npm run build` passou; `npm run db:push:deploy -- --help` confirmou suporte a `--skip-generate`; `git diff --check` passou; `docker build -t qc-backend-dokploy-debug .` passou; `docker run --rm qc-backend-dokploy-debug npx prisma generate` passou como usuário runtime sem EACCES; `docker run --rm qc-backend-dokploy-debug npm run db:push:deploy -- --help` passou."
files_changed:
  - Dockerfile
  - package.json
  - .env.example
  - docs/technical/DOKPLOY_DEPLOYMENT.md
  - .planning/debug/dokploy-prisma-generate-eacces.md
