# API Documentation — Scalar + swagger-jsdoc

**Data:** 2026-04-15
**Branch:** feat/core-gap-closure
**Status:** Aprovado

## Objetivo

Adicionar documentação interativa da API ao projeto Quantum Cert Diamond API, permitindo que desenvolvedores internos e parceiros B2B visualizem e testem os endpoints diretamente pela interface web. Em desenvolvimento, as credenciais são pré-preenchidas para agilizar os testes.

## Abordagem Escolhida

**Code-first com swagger-jsdoc + Scalar UI**

- `swagger-jsdoc` lê blocos `@openapi` (JSDoc) nos arquivos de rota e gera a spec OpenAPI 3.0 em memória
- `@scalar/express-api-reference` serve a UI Scalar no Express, consumindo a spec gerada
- Zero refatoração de controllers ou mudança de arquitetura

## Pacotes

```
dependencies:
  @scalar/express-api-reference   ← UI interativa (prod dep — servida em runtime)

devDependencies:
  swagger-jsdoc                   ← geração da spec a partir de JSDoc
  @types/swagger-jsdoc            ← tipos TS
```

`@scalar/express-api-reference` vai em `dependencies` porque é servida em runtime (não só em build).
`swagger-jsdoc` vai em `devDependencies` porque só roda no servidor Node — não há build step separado, mas semanticamente é tooling.

> **Nota:** na prática, como o projeto usa `tsx` (não transpila para bundle), ambos precisam estar em `dependencies` para rodar em produção. Ajustar se necessário.

## Arquitetura

```
src/docs/openapi.ts              ← instância swagger-jsdoc + config global (info, servers, securitySchemes, schemas)
src/routes/v1/docsRoutes.ts     ← GET /api-docs (UI Scalar) + GET /api-docs/spec.json (spec bruta)
src/server.ts                   ← app.use('/', docsRoutes)  ← única linha adicionada
.env / .env.example             ← DOCS_DEFAULT_API_KEY
```

### Fluxo em Runtime

```
swagger-jsdoc escaneia arquivos de rota (globs configurados em openapi.ts)
    ↓
retorna objeto OpenAPI 3.0 em memória (sem arquivo em disco)
    ↓
GET /api-docs/spec.json  → res.json(spec)
GET /api-docs            → Scalar UI aponta para /api-docs/spec.json
```

## Endpoints de Documentação

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api-docs` | UI Scalar (HTML interativo) |
| GET | `/api-docs/spec.json` | Spec OpenAPI 3.0 em JSON |

Ambas as rotas são montadas **fora** do prefixo `/api` (diferente das rotas de negócio), para clareza e para não conflitar com o rate limiter de API por tenant.

## Security Scheme

```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
```

- Endpoints protegidos: `security: [{ ApiKeyAuth: [] }]`
- Endpoints públicos (health, webhook MercadoPago): `security: []` explicitamente

## Comportamento por Ambiente

| Ambiente | `/api-docs` | X-API-Key pré-preenchido |
|----------|-------------|--------------------------|
| `development` | Acessível | Sim — valor de `DOCS_DEFAULT_API_KEY` no `.env` |
| `production` | Acessível | Não — campo vazio, usuário insere manualmente |

Configuração no `docsRoutes.ts`:

```typescript
authentication: {
  preferredSecurityScheme: 'ApiKeyAuth',
  apiKey: {
    token: process.env.NODE_ENV === 'development'
      ? (process.env.DOCS_DEFAULT_API_KEY ?? '')
      : ''
  }
}
```

## Helmet / CSP

O `helmet()` global em `server.ts` bloqueia iframes e scripts inline, quebrando a UI do Scalar. O `docsRoutes.ts` aplica `helmet({ contentSecurityPolicy: false })` **somente nas rotas `/api-docs*`** via middleware local, sem alterar a política global.

## Cobertura de Endpoints

Todos os endpoints ativos montados em `src/routes/index.ts`:

| Grupo | Arquivo de rota |
|-------|----------------|
| Tenants | `v1/tenantRoutes.ts` |
| API Keys | `v1/apiKeyRoutes.ts` |
| Assets | `v1/assetRoutes.ts` |
| Devices | `v1/deviceRoutes.ts` |
| Lifecycle | `v1/lifecycleRoutes.ts` |
| Transfers | `v1/transferRoutes.ts` |
| Webhooks | `v1/webhookRoutes.ts` |
| Diamond Proxy | `diamond/DiamondProxy.ts` |

Endpoint `/health` documentado também (sem auth, como referência).

## Schemas Reutilizáveis (components.schemas)

Definidos em `src/docs/openapi.ts`, referenciados via `$ref` nos blocos JSDoc:

- `Asset` — campos principais + metadata opaco
- `CreateAssetPayload` — body do POST /assets
- `Tenant` — campos do tenant
- `CreateTenantPayload`
- `ApiKey` — representação da chave (sem o valor raw)
- `GenerateApiKeyPayload`
- `EventLog` — registro de evento DLT
- `LifecycleTransitionPayload` — body do PATCH lifecycle
- `TransferPayload` — body do POST transfer
- `ErrorResponse` — shape padrão de erro `{ success: false, error: string }`
- `SuccessResponse` — shape padrão de sucesso `{ success: true, data: object }`

## Padrão JSDoc nas Rotas

Bloco adicionado **acima** de cada declaração `router.METHOD(...)`:

```typescript
/**
 * @openapi
 * /api/v1/assets:
 *   post:
 *     summary: Registrar um novo ativo
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAssetPayload'
 *     responses:
 *       201:
 *         description: Ativo criado com sucesso
 *       401:
 *         description: API key inválida ou ausente
 *       409:
 *         description: Chave de idempotência duplicada
 *       422:
 *         description: Payload inválido
 */
router.post('/', requireApiKey, requireIdempotency, ...)
```

## O que NÃO está no escopo

- Geração de arquivo `openapi.yaml` em disco (a spec fica em memória)
- Upload ou edição de spec via UI
- Autenticação/proteção do endpoint `/api-docs` em produção (a UI é pública, mas executar chamadas requer chave válida)
- Sincronização automática com schemas Prisma ou Zod (schemas OpenAPI são escritos manualmente em `openapi.ts`)

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `src/server.ts` | `app.use('/', docsRoutes)` após middleware global |
| `.env.example` | `DOCS_DEFAULT_API_KEY=qc_sua_chave_dev_aqui` |
| `package.json` | adicionar `@scalar/express-api-reference`, `swagger-jsdoc`, `@types/swagger-jsdoc` |
| `src/routes/v1/*.ts` | blocos JSDoc `@openapi` em cada endpoint |

## Arquivos Criados

| Arquivo | Conteúdo |
|---------|----------|
| `src/docs/openapi.ts` | Config swagger-jsdoc: info, servers, securitySchemes, components.schemas |
| `src/routes/v1/docsRoutes.ts` | Router Express: GET /api-docs + GET /api-docs/spec.json |
