# Deploy no Dokploy

## Causa do restart atual

O container estava executando `prisma db push` durante o deploy. Esse comando sincroniza o schema e, por padrão, também roda `prisma generate`.

Na imagem Docker, o Prisma Client é gerado durante o build. Se o deploy roda outro `generate` no startup como usuário `node`, o Prisma tenta sobrescrever arquivos em `/app/node_modules/.prisma/client`. Sem permissão de escrita, o startup falha com:

```text
EACCES: permission denied, unlink '/app/node_modules/.prisma/client/index.js'
```

Além disso, em `NODE_ENV=production`, o servidor aborta se secrets obrigatórios não estiverem definidos.

## Comando recomendado

No Dokploy, use um comando de deploy/startup que não regenere o Prisma Client em runtime:

```bash
npm run db:push:deploy && npm start
```

Esse script executa:

```bash
prisma db push --skip-generate
```

O Prisma Client já é gerado no build da imagem.

## Variáveis obrigatórias em produção

Configure no Dokploy:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
ALGOD_SERVER=...
ALGORAND_MASTER_MNEMONIC=...
QUANTUM_CERT_SECRET=...
MP_ACCESS_TOKEN=...
MP_WEBHOOK_SECRET=...
CIRCUIT_BREAKER_ADMIN_PUBKEY=...
```

Gere `QUANTUM_CERT_SECRET` com:

```bash
openssl rand -hex 64
```

`CIRCUIT_BREAKER_ADMIN_PUBKEY` deve ser a chave pública Falcon-512 em hex. A chave privada correspondente deve ficar offline, fora do Dokploy.

## Observação

O Dockerfile também ajusta a posse de `/app` para o usuário `node`. Isso evita o `EACCES` se algum hook legado ainda executar `prisma generate`, mas o caminho recomendado continua sendo `--skip-generate` em runtime.
