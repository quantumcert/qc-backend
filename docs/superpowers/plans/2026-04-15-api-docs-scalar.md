# API Docs (Scalar + swagger-jsdoc) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Adicionar documentação interativa da API com testes embutidos via Scalar UI, gerada a partir de anotações JSDoc nas rotas existentes.

**Architecture:** `swagger-jsdoc` lê blocos `@openapi` nos arquivos de rota e gera a spec OpenAPI 3.0 em memória. `@scalar/express-api-reference` serve a UI em `/api-docs`. Em dev, o `X-API-Key` é pré-preenchido via env var.

**Tech Stack:** swagger-jsdoc, @scalar/express-api-reference, Express, TypeScript, Vitest + Supertest

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `src/docs/openapi.ts` | Criar | Config swagger-jsdoc: info, servers, securitySchemes, schemas |
| `src/routes/v1/docsRoutes.ts` | Criar | GET /api-docs (Scalar UI) + GET /api-docs/spec.json |
| `tests/docs.test.ts` | Criar | Testes de integração dos endpoints de docs |
| `src/server.ts` | Modificar | Montar docsRoutes antes dos error handlers |
| `.env.example` | Modificar | Adicionar DOCS_DEFAULT_API_KEY |
| `src/routes/v1/tenantRoutes.ts` | Modificar | Blocos JSDoc @openapi |
| `src/routes/v1/apiKeyRoutes.ts` | Modificar | Blocos JSDoc @openapi |
| `src/routes/v1/assetRoutes.ts` | Modificar | Blocos JSDoc @openapi |
| `src/routes/v1/lifecycleRoutes.ts` | Modificar | Bloco JSDoc @openapi |
| `src/routes/v1/transferRoutes.ts` | Modificar | Bloco JSDoc @openapi |
| `src/routes/v1/deviceRoutes.ts` | Modificar | Blocos JSDoc @openapi |
| `src/routes/v1/webhookRoutes.ts` | Modificar | Bloco JSDoc @openapi |
| `src/routes/index.ts` | Modificar | Bloco JSDoc @openapi para POST /api/v1/diamond |
| `src/server.ts` | Modificar | Bloco JSDoc @openapi para GET /health |

---

## Task 1: Instalar pacotes

**Files:**
- Modify: `package.json`

- [x] **Step 1: Instalar dependências**

```bash
cd "/Volumes/External SSD/Projects/backend-QC-new"
npm install @scalar/express-api-reference swagger-jsdoc
npm install --save-dev @types/swagger-jsdoc
```

Expected: `added N packages` sem erros

- [x] **Step 2: Verificar instalação**

```bash
node -e "require('@scalar/express-api-reference'); require('swagger-jsdoc'); console.log('OK')"
```

Expected: `OK`

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add swagger-jsdoc and @scalar/express-api-reference"
```

---

## Task 2: Criar `src/docs/openapi.ts`

**Files:**
- Create: `src/docs/openapi.ts`

- [x] **Step 1: Criar o arquivo**

```typescript
// src/docs/openapi.ts
// ═══════════════════════════════════════════════════════════
// OPENAPI SPEC CONFIG — swagger-jsdoc
// Gera a spec OpenAPI 3.0 em memória a partir dos blocos
// @openapi nos arquivos de rota.
// ═══════════════════════════════════════════════════════════

import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Quantum Cert Diamond API',
      version: '3.0.0',
      description:
        'Universal multi-tenant API built on the EIP-2535 Diamond Pattern. ' +
        'All authenticated endpoints require an `X-API-Key` header with a `qc_` prefixed key. ' +
        'Mutating endpoints (POST, PATCH) require an `X-Idempotency-Key` (UUIDv4) header.',
      contact: {
        name: 'Quantum Cert',
        url: 'https://quantumcert.io',
      },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' },
      { url: 'https://api.quantumcert.io', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key com prefixo `qc_`. Gerada via POST /api/v1/api-keys.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Mensagem de erro descritiva' },
          },
        },
        SuccessResponse: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },
        Tenant: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Acme Corp' },
            plan: { type: 'string', enum: ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'] },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateTenantPayload: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', example: 'Acme Corp' },
            plan: {
              type: 'string',
              enum: ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'],
              default: 'FREE',
            },
          },
        },
        UpdateTenantPayload: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Acme Corp Updated' },
            plan: { type: 'string', enum: ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'] },
          },
        },
        ApiKey: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            tenantId: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Chave de produção' },
            role: { type: 'string', enum: ['ADMIN', 'OPERATOR', 'READER'] },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        GenerateApiKeyPayload: {
          type: 'object',
          required: ['tenantId', 'name', 'role'],
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Chave de integração' },
            role: { type: 'string', enum: ['ADMIN', 'OPERATOR', 'READER'] },
          },
        },
        Asset: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            tenantId: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BURNED', 'AWAITING_PAYMENT'],
            },
            metadata: {
              type: 'object',
              description: 'Blob JSON opaco — o core não interpreta, apenas valida hash SHA3-512.',
            },
            signatureHash: { type: 'string', description: 'SHA3-512 do metadata' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateAssetPayload: {
          type: 'object',
          required: ['metadata'],
          properties: {
            metadata: {
              type: 'object',
              description: 'Dados do ativo. Blob JSON livre — será hash-validado via SHA3-512.',
              example: { type: 'product', sku: 'SKU-001', serial: 'SN-XYZ' },
            },
          },
        },
        LifecycleTransitionPayload: {
          type: 'object',
          required: ['targetStatus'],
          properties: {
            targetStatus: {
              type: 'string',
              enum: ['ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BURNED'],
              description: 'Estado de destino. Transições inválidas retornam 422.',
            },
            reason: { type: 'string', example: 'Produto vendido e entregue' },
          },
        },
        TransferPayload: {
          type: 'object',
          required: ['newOwnerId'],
          properties: {
            newOwnerId: {
              type: 'string',
              format: 'uuid',
              description: 'ID do novo proprietário. Dispara cobrança via BillingFacet.',
            },
          },
        },
        DiamondCallPayload: {
          type: 'object',
          required: ['selector', 'payload'],
          properties: {
            selector: {
              type: 'string',
              example: 'AssetRegistryFacet.registerAsset',
              description: 'Selector no formato FacetName.methodName',
            },
            payload: {
              type: 'object',
              description: 'Payload repassado diretamente ao Facet selecionado.',
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: [
    './src/routes/v1/*.ts',
    './src/routes/index.ts',
    './src/server.ts',
  ],
};

let _cachedSpec: object | null = null;

export function getSpec(): object {
  if (!_cachedSpec) {
    _cachedSpec = swaggerJsdoc(options);
  }
  return _cachedSpec;
}
```

- [x] **Step 2: Verificar que compila sem erros**

```bash
cd "/Volumes/External SSD/Projects/backend-QC-new"
npx tsc --noEmit
```

Expected: sem erros de tipo

---

## Task 3: Escrever testes para os endpoints de docs (TDD)

**Files:**
- Create: `tests/docs.test.ts`

- [x] **Step 1: Criar o arquivo de teste**

```typescript
// tests/docs.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import supertest from 'supertest';

// Mock mínimo do Prisma — evita conexão real no CI
vi.mock('../src/config/prisma', () => ({
  default: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock do SchedulerService — evita cron jobs em teste
vi.mock('../src/services/SchedulerService', () => ({
  SchedulerService: { start: vi.fn() },
}));

let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  const { app } = await import('../src/server');
  request = supertest(app);
});

describe('GET /api-docs/spec.json', () => {
  it('retorna status 200', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.status).toBe(200);
  });

  it('retorna Content-Type application/json', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('retorna spec OpenAPI 3.0 válida', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Quantum Cert Diamond API');
    expect(res.body.info.version).toBe('3.0.0');
    expect(res.body.components.securitySchemes.ApiKeyAuth).toBeDefined();
  });

  it('expõe paths da API', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.body.paths).toBeDefined();
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(0);
  });
});

describe('GET /api-docs', () => {
  it('retorna status 200', async () => {
    const res = await request.get('/api-docs');
    expect(res.status).toBe(200);
  });

  it('retorna HTML com a UI Scalar', async () => {
    const res = await request.get('/api-docs');
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Quantum Cert Diamond API');
  });
});
```

- [x] **Step 2: Rodar os testes e confirmar que falham (docsRoutes ainda não existe)**

```bash
cd "/Volumes/External SSD/Projects/backend-QC-new"
npx vitest run tests/docs.test.ts
```

Expected: FAIL — `Cannot find module` ou `404` nos endpoints

---

## Task 4: Criar `src/routes/v1/docsRoutes.ts`

**Files:**
- Create: `src/routes/v1/docsRoutes.ts`

- [x] **Step 1: Criar o arquivo**

```typescript
// src/routes/v1/docsRoutes.ts
// ═══════════════════════════════════════════════════════════
// DOCS ROUTES — Scalar API Reference
//
// GET /api-docs        → Scalar UI (HTML interativo)
// GET /api-docs/spec.json → Spec OpenAPI 3.0 em JSON
//
// Helmet CSP desabilitado localmente — Scalar precisa de
// scripts inline. A política global (server.ts) permanece
// intacta para todas as outras rotas.
// ═══════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import helmet from 'helmet';
import { apiReference } from '@scalar/express-api-reference';
import { getSpec } from '../../docs/openapi';

const router = Router();

// Desabilita CSP apenas para /api-docs* (Scalar usa scripts inline)
router.use(helmet({ contentSecurityPolicy: false }));

// Spec JSON bruta — consumida pelo Scalar e por ferramentas externas
router.get('/api-docs/spec.json', (_req: Request, res: Response) => {
  res.json(getSpec());
});

// UI Scalar interativa
router.use(
  '/api-docs',
  apiReference({
    spec: { url: '/api-docs/spec.json' },
    theme: 'default',
    authentication: {
      preferredSecurityScheme: 'ApiKeyAuth',
      apiKey: {
        token:
          process.env.NODE_ENV === 'development'
            ? (process.env.DOCS_DEFAULT_API_KEY ?? '')
            : '',
      },
    },
    metaData: {
      title: 'Quantum Cert Diamond API',
    },
  }),
);

export default router;
```

---

## Task 5: Montar docsRoutes em `server.ts` e atualizar `.env.example`

**Files:**
- Modify: `src/server.ts`
- Modify: `.env.example`

- [x] **Step 1: Adicionar import e mount em `src/server.ts`**

Logo após os outros imports de routes (antes de `import routes from './routes/index'`), adicione:

```typescript
import docsRoutes from './routes/v1/docsRoutes';
```

No bloco de configuração do app, adicione **antes** do `app.use(notFoundHandler)`:

```typescript
// ─────────────────────────────────────────────────────────
// API DOCUMENTATION (Scalar UI)
// ─────────────────────────────────────────────────────────
app.use('/', docsRoutes);
```

A posição correta é após `app.use('/api', routes)` e antes de `app.use(notFoundHandler)`.

- [x] **Step 2: Adicionar env var ao `.env.example`**

Leia o `.env.example` e adicione no final:

```dotenv
# API Documentation — chave pré-preenchida no Scalar em desenvolvimento
# Deixe vazio em produção. Gere uma chave via POST /api/v1/api-keys.
DOCS_DEFAULT_API_KEY=qc_sua_chave_dev_aqui
```

- [x] **Step 3: Rodar os testes para confirmar que passam**

```bash
cd "/Volumes/External SSD/Projects/backend-QC-new"
npx vitest run tests/docs.test.ts
```

Expected: todos os testes passam (5 passes)

- [x] **Step 4: Verificar compilação TypeScript**

```bash
npx tsc --noEmit
```

Expected: sem erros

- [x] **Step 5: Commit**

```bash
git add src/docs/openapi.ts src/routes/v1/docsRoutes.ts src/server.ts .env.example tests/docs.test.ts
git commit -m "feat(docs): add Scalar API docs — /api-docs UI + /api-docs/spec.json"
```

---

## Task 6: JSDoc para `tenantRoutes.ts`

**Files:**
- Modify: `src/routes/v1/tenantRoutes.ts`

- [x] **Step 1: Substituir o conteúdo do arquivo com os blocos JSDoc**

```typescript
// ═══════════════════════════════════════════════════════════
// ROUTES: Tenant Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// All Tenant operations require ADMIN-level API key.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { TenantController } from '../../controllers/TenantController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.use(requireApiKey, tenantRateLimiter, requireAdmin);

/**
 * @openapi
 * /api/v1/tenants:
 *   post:
 *     summary: Criar um novo tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUIDv4 único para prevenir duplicatas
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTenantPayload'
 *     responses:
 *       201:
 *         description: Tenant criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Tenant'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role insuficiente (requer ADMIN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Idempotency key duplicada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', TenantController.create);

/**
 * @openapi
 * /api/v1/tenants:
 *   get:
 *     summary: Listar todos os tenants
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Lista de tenants
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Tenant'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', TenantController.list);

/**
 * @openapi
 * /api/v1/tenants/{id}:
 *   get:
 *     summary: Buscar tenant por ID
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tenant encontrado
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Tenant'
 *       404:
 *         description: Tenant não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', TenantController.getById);

/**
 * @openapi
 * /api/v1/tenants/{id}:
 *   patch:
 *     summary: Atualizar tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTenantPayload'
 *     responses:
 *       200:
 *         description: Tenant atualizado
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Tenant'
 *       404:
 *         description: Tenant não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id', TenantController.update);

/**
 * @openapi
 * /api/v1/tenants/{id}/deactivate:
 *   post:
 *     summary: Desativar tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tenant desativado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Tenant não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/deactivate', TenantController.deactivate);

/**
 * @openapi
 * /api/v1/tenants/{id}/reactivate:
 *   post:
 *     summary: Reativar tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tenant reativado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Tenant não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/reactivate', TenantController.reactivate);

/**
 * @openapi
 * /api/v1/tenants/{id}/usage:
 *   get:
 *     summary: Consultar uso de rate limit do tenant
 *     tags: [Tenants]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Estatísticas de uso do tenant
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         minuteUsage:
 *                           type: integer
 *                         minuteLimit:
 *                           type: integer
 *                         dayUsage:
 *                           type: integer
 *                         dayLimit:
 *                           type: integer
 *       404:
 *         description: Tenant não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id/usage', TenantController.getUsage);

export default router;
```

- [x] **Step 2: Verificar spec contém paths de tenants**

```bash
cd "/Volumes/External SSD/Projects/backend-QC-new"
npx vitest run tests/docs.test.ts
```

Expected: todos os testes passam

- [x] **Step 3: Verificar via curl que o path aparece**

```bash
curl -s http://localhost:3000/api-docs/spec.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(Object.keys(d.paths).filter(p=>p.includes('tenant')))"
```

Expected: `[ '/api/v1/tenants', '/api/v1/tenants/{id}', ... ]`

> Nota: o servidor precisa estar rodando (`npm run dev`) para esse curl funcionar.

---

## Task 7: JSDoc para `apiKeyRoutes.ts`

**Files:**
- Modify: `src/routes/v1/apiKeyRoutes.ts`

- [x] **Step 1: Substituir o conteúdo do arquivo com os blocos JSDoc**

```typescript
// ═══════════════════════════════════════════════════════════
// ROUTES: API Key Management
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { ApiKeyController } from '../../controllers/ApiKeyController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.use(requireApiKey, tenantRateLimiter, requireAdmin);

/**
 * @openapi
 * /api/v1/api-keys:
 *   post:
 *     summary: Gerar uma nova API key para um tenant
 *     tags: [API Keys]
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
 *             $ref: '#/components/schemas/GenerateApiKeyPayload'
 *     responses:
 *       201:
 *         description: API key gerada. O valor raw (`key`) é exibido apenas uma vez.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         key:
 *                           type: string
 *                           example: qc_abc123...
 *                           description: Valor raw — armazene imediatamente, não será exibido novamente
 *                         apiKey:
 *                           $ref: '#/components/schemas/ApiKey'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', ApiKeyController.generate);

/**
 * @openapi
 * /api/v1/api-keys/{tenantId}:
 *   get:
 *     summary: Listar API keys de um tenant
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lista de API keys (sem valores raw)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ApiKey'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:tenantId', ApiKeyController.list);

/**
 * @openapi
 * /api/v1/api-keys/{id}:
 *   delete:
 *     summary: Revogar uma API key
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: API key revogada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: API key não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', ApiKeyController.revoke);

/**
 * @openapi
 * /api/v1/api-keys/{id}/rotate:
 *   post:
 *     summary: Rotacionar uma API key (gerar novo valor)
 *     tags: [API Keys]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: X-Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Novo valor da chave. O anterior é invalidado imediatamente.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         key:
 *                           type: string
 *                           example: qc_novo_valor...
 *       404:
 *         description: API key não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/rotate', ApiKeyController.rotate);

export default router;
```

- [x] **Step 2: Rodar testes**

```bash
npx vitest run tests/docs.test.ts
```

Expected: todos passam

---

## Task 8: JSDoc para `assetRoutes.ts`

**Files:**
- Modify: `src/routes/v1/assetRoutes.ts`

- [x] **Step 1: Substituir o conteúdo do arquivo com os blocos JSDoc**

```typescript
// ═══════════════════════════════════════════════════════════
// ASSET ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { AssetController } from '../../controllers/AssetController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator, requireReader } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
import transferRoutes from './transferRoutes';

const router = Router();

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
 *         description: Ativo registrado. Hash SHA3-512 gerado automaticamente.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role insuficiente (requer OPERATOR ou ADMIN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Idempotency key duplicada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, AssetController.create);

/**
 * @openapi
 * /api/v1/assets:
 *   get:
 *     summary: Listar ativos do tenant
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, ACTIVE, SUSPENDED, ARCHIVED, BURNED, AWAITING_PAYMENT]
 *         description: Filtrar por status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Lista paginada de ativos
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Asset'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', requireApiKey, tenantRateLimiter, requireReader, AssetController.list);

/**
 * @openapi
 * /api/v1/assets/{id}:
 *   get:
 *     summary: Buscar ativo por ID
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Ativo encontrado
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       404:
 *         description: Ativo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', requireApiKey, tenantRateLimiter, requireReader, AssetController.getById);

/**
 * @openapi
 * /api/v1/assets/{id}/owners:
 *   patch:
 *     summary: Adicionar proprietário ao ativo
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *             type: object
 *             required:
 *               - ownerId
 *             properties:
 *               ownerId:
 *                 type: string
 *                 format: uuid
 *               role:
 *                 type: string
 *                 example: PRIMARY
 *     responses:
 *       200:
 *         description: Proprietário adicionado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Ativo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id/owners', requireApiKey, requireIdempotency, tenantRateLimiter, requireOperator, AssetController.addOwner);

router.use('/', transferRoutes);

export default router;
```

- [x] **Step 2: Rodar testes**

```bash
npx vitest run tests/docs.test.ts
```

Expected: todos passam

---

## Task 9: JSDoc para `lifecycleRoutes.ts`

**Files:**
- Modify: `src/routes/v1/lifecycleRoutes.ts`

- [x] **Step 1: Substituir o conteúdo do arquivo com o bloco JSDoc**

```typescript
// ═══════════════════════════════════════════════════════════
// ROUTE: Asset Lifecycle
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { LifecycleController } from '../../controllers/LifecycleController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

const router = Router();

/**
 * @openapi
 * /api/v1/assets/{assetId}/lifecycle:
 *   patch:
 *     summary: Transicionar estado do ativo
 *     description: |
 *       Máquina de estados do ativo. Transições permitidas:
 *       - `DRAFT → ACTIVE`
 *       - `ACTIVE → SUSPENDED → ACTIVE`
 *       - `ACTIVE → ARCHIVED`
 *       - `ACTIVE → BURNED` (terminal, irreversível)
 *       - `ACTIVE → AWAITING_PAYMENT` (gerenciado pelo BillingFacet)
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *             $ref: '#/components/schemas/LifecycleTransitionPayload'
 *     responses:
 *       200:
 *         description: Transição executada com sucesso. EventLog registrado.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       422:
 *         description: Transição inválida para o estado atual do ativo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ativo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch(
  '/:assetId/lifecycle',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireOperator,
  LifecycleController.transition,
);

export default router;
```

- [x] **Step 2: Rodar testes**

```bash
npx vitest run tests/docs.test.ts
```

Expected: todos passam

---

## Task 10: JSDoc para `transferRoutes.ts`

**Files:**
- Modify: `src/routes/v1/transferRoutes.ts`

- [x] **Step 1: Substituir o conteúdo do arquivo com o bloco JSDoc**

```typescript
// ═══════════════════════════════════════════════════════════
// ROUTE: Asset Transfer
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { TransferController } from '../../controllers/TransferController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

const router = Router();

/**
 * @openapi
 * /api/v1/assets/{assetId}/transfer:
 *   patch:
 *     summary: Iniciar transferência de propriedade do ativo
 *     description: |
 *       Inicia o fluxo de transferência. O ativo entra em `AWAITING_PAYMENT`.
 *       Após confirmação de pagamento via webhook MercadoPago, o BillingFacet
 *       confirma a transferência e retorna o ativo para `ACTIVE`.
 *     tags: [Assets]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *             $ref: '#/components/schemas/TransferPayload'
 *     responses:
 *       200:
 *         description: Transferência iniciada. Aguardando confirmação de pagamento.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       422:
 *         description: Ativo não está em estado transferível (requer ACTIVE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ativo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch(
  '/:assetId/transfer',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireOperator,
  TransferController.initiate,
);

export default router;
```

- [x] **Step 2: Rodar testes**

```bash
npx vitest run tests/docs.test.ts
```

Expected: todos passam

---

## Task 11: JSDoc para `deviceRoutes.ts`

**Files:**
- Modify: `src/routes/v1/deviceRoutes.ts`

- [x] **Step 1: Substituir o conteúdo do arquivo com os blocos JSDoc**

```typescript
// ═══════════════════════════════════════════════════════════
// DEVICE ROUTES
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { DeviceController } from '../../controllers/DeviceController';
import { requireApiKey, optionalApiKey } from '../../middleware/apiKeyAuth';
import { requireAdmin } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
import rateLimit from 'express-rate-limit';

const router = Router();

const nfcValidateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many NFC validation attempts from this IP, please try again after a minute' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @openapi
 * /api/v1/devices:
 *   post:
 *     summary: Registrar um novo dispositivo (NFC/RFID)
 *     tags: [Devices]
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
 *             type: object
 *             required:
 *               - uid
 *               - assetId
 *             properties:
 *               uid:
 *                 type: string
 *                 description: UID físico do chip NFC/RFID
 *                 example: 04:AB:CD:EF:12:34:56
 *               assetId:
 *                 type: string
 *                 format: uuid
 *                 description: ID do ativo vinculado ao dispositivo
 *     responses:
 *       201:
 *         description: Dispositivo registrado e vinculado ao ativo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Role insuficiente (requer ADMIN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', requireApiKey, requireIdempotency, tenantRateLimiter, requireAdmin, DeviceController.register);

/**
 * @openapi
 * /api/v1/devices/tap:
 *   get:
 *     summary: Validar toque NFC (público ou autenticado)
 *     description: |
 *       Endpoint de validação de tap NFC. Aceita requisições sem API key (validação pública via URL)
 *       ou com API key (validação autenticada). Limitado a 5 requisições/min por IP.
 *     tags: [Devices]
 *     security:
 *       - ApiKeyAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *         description: UID do chip NFC lido
 *         example: 04ABCDEF123456
 *       - in: query
 *         name: counter
 *         schema:
 *           type: integer
 *         description: Contador de taps do chip (anti-clone)
 *     responses:
 *       200:
 *         description: Tap validado — retorna dados do ativo vinculado
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Asset'
 *       404:
 *         description: Dispositivo não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Muitas tentativas — aguarde 1 minuto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/tap', nfcValidateLimiter, optionalApiKey, tenantRateLimiter, DeviceController.validateTap);

export default router;
```

- [x] **Step 2: Rodar testes**

```bash
npx vitest run tests/docs.test.ts
```

Expected: todos passam

---

## Task 12: JSDoc para `webhookRoutes.ts`, `routes/index.ts` e `/health`

**Files:**
- Modify: `src/routes/v1/webhookRoutes.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/server.ts` (apenas bloco JSDoc no /health)

- [x] **Step 1: Atualizar `src/routes/v1/webhookRoutes.ts`**

```typescript
// src/routes/v1/webhookRoutes.ts
import { Router } from 'express';
import { WebhookController } from '../../controllers/WebhookController';

const router = Router();

/**
 * @openapi
 * /api/v1/webhooks/mercadopago:
 *   post:
 *     summary: Webhook de pagamento MercadoPago
 *     description: |
 *       Endpoint público (sem API key). A autenticidade é verificada via HMAC SHA-256
 *       do payload com o `MP_WEBHOOK_SECRET`. Pagamentos confirmados disparam a
 *       conclusão da transferência de ativos pendentes.
 *     tags: [Webhooks]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: x-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: Assinatura HMAC SHA-256 enviada pelo MercadoPago
 *       - in: header
 *         name: x-request-id
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Payload padrão do MercadoPago (action, data.id)
 *             example:
 *               action: payment.updated
 *               data:
 *                 id: "123456789"
 *     responses:
 *       200:
 *         description: Webhook processado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Assinatura HMAC inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/mercadopago', WebhookController.handleMercadoPago);

export default router;
```

- [x] **Step 2: Adicionar JSDoc do Diamond Proxy em `src/routes/index.ts`**

Logo acima da linha `router.post('/v1/diamond', requireApiKey, DiamondProxy.delegateCall)`, adicione:

```typescript
/**
 * @openapi
 * /api/v1/diamond:
 *   post:
 *     summary: Diamond Proxy — roteador universal de Facets
 *     description: |
 *       Ponto de entrada para operações via Diamond Pattern. O selector mapeia para
 *       uma função de Facet registrada no FacetRegistry. O secureContext é injetado
 *       pelo middleware — nunca confie em tenantId vindo do payload.
 *     tags: [Diamond]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DiamondCallPayload'
 *     responses:
 *       200:
 *         description: Facet executado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Selector inválido ou não registrado no FacetRegistry
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: API key ausente ou inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/v1/diamond', requireApiKey, DiamondProxy.delegateCall);
```

- [x] **Step 3: Adicionar JSDoc do /health em `src/server.ts`**

Logo acima da linha `app.get('/health', async (req, res) => {`, adicione:

```typescript
/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check do servidor
 *     description: Verifica se o servidor e o banco de dados estão operacionais. Não requer autenticação.
 *     tags: [System]
 *     security: []
 *     responses:
 *       200:
 *         description: Servidor saudável
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           example: ok
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *                         database:
 *                           type: string
 *                           enum: [connected, disconnected, unknown]
 */
app.get('/health', async (req, res) => {
```

- [x] **Step 4: Rodar todos os testes**

```bash
cd "/Volumes/External SSD/Projects/backend-QC-new"
npx vitest run tests/docs.test.ts
```

Expected: todos os 5 testes passam

- [x] **Step 5: Rodar a suite completa para garantir nenhuma regressão**

```bash
npx vitest run
```

Expected: todos os testes existentes continuam passando

- [x] **Step 6: Verificar que o TypeScript compila**

```bash
npx tsc --noEmit
```

Expected: sem erros

- [x] **Step 7: Commit final**

```bash
git add src/routes/v1/tenantRoutes.ts src/routes/v1/apiKeyRoutes.ts src/routes/v1/assetRoutes.ts
git add src/routes/v1/lifecycleRoutes.ts src/routes/v1/transferRoutes.ts src/routes/v1/deviceRoutes.ts
git add src/routes/v1/webhookRoutes.ts src/routes/index.ts src/server.ts
git commit -m "docs(openapi): add @openapi JSDoc annotations to all routes"
```

---

## Self-Review

**Cobertura da spec:**
- [x] `/api-docs` e `/api-docs/spec.json` — Task 4
- [x] swagger-jsdoc + schemas — Task 2
- [x] docsRoutes com helmet CSP local — Task 4
- [x] Dev com `DOCS_DEFAULT_API_KEY` pré-preenchido — Task 5
- [x] Todos os grupos de endpoints documentados — Tasks 6-12
- [x] `security: []` em endpoints públicos (webhook, /health, /devices/tap com `{}`) — Task 12
- [x] Cache da spec em memória (`_cachedSpec`) — Task 2

**Placeholder scan:** nenhum TBD, nenhum "implement later".

**Consistência de tipos:**
- `getSpec()` definida em `openapi.ts` (Task 2), importada em `docsRoutes.ts` (Task 4) — consistente
- Schemas `$ref` usados nos JSDoc existem todos em `components.schemas` do `openapi.ts`
- `DiamondCallPayload` definido em Task 2, referenciado em Task 12 — consistente
