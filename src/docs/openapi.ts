// src/docs/openapi.ts
// ═══════════════════════════════════════════════════════════
// OPENAPI SPEC CONFIG — swagger-jsdoc
// Builds the OpenAPI 3.0 spec in-memory from @openapi blocks
// in route files.
// ═══════════════════════════════════════════════════════════

import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

// In production the compiled file lives at dist/docs/openapi.js, so __dirname
// points into dist/. In dev (tsx) it points into src/. Detect and use correct ext.
const isProd = __dirname.includes(`${path.sep}dist${path.sep}`) || __dirname.endsWith(`${path.sep}dist`);
const ext = isProd ? 'js' : 'ts';

// Route files scanned for @openapi annotations.
// Internal routes (admin, agent, circuit-breaker) are included only outside production
// so they never appear in the public-facing Scalar UI.
const publicRouteFiles = [
  'tenantRoutes', 'apiKeyRoutes', 'assetRoutes', 'authRoutes',
  'deviceRoutes', 'publicRoutes', 'webhookRoutes', 'walletRoutes',
  'userRoutes', 'contributionRoutes', 'docsRoutes',
].map((name) => path.resolve(__dirname, `../routes/v1/${name}.${ext}`));

const internalRouteFiles = [
  'adminRoutes', 'agentRoutes', 'circuitBreakerRoutes',
].map((name) => path.resolve(__dirname, `../routes/v1/${name}.${ext}`));

const isProduction = process.env.NODE_ENV === 'production';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Quantum Cert Diamond API',
      version: '3.0.0',
      description: `
## What is this?

**Quantum Cert** is a multi-tenant asset certification and traceability platform. This API lets you register
physical or digital assets, anchor their authenticity proofs to public blockchains, and verify them publicly
— without ever exposing sensitive data.

Built on the **EIP-2535 Diamond Pattern**, every feature is a Facet routed through a single proxy.
The result is a stable, versioned surface where capabilities grow without breaking integrations.

---

## Core concepts

| Concept | Description |
|---|---|
| **Tenant** | An isolated workspace. All assets, keys, and events are scoped to a tenant. |
| **Asset** | Any entity you want to certify — a product, document, device, or certificate. Its metadata is hashed via SHA3-512 and optionally anchored on-chain. |
| **API Key** | A \`qc_live_*\` credential tied to a tenant with an RBAC role. |
| **Event** | An immutable log entry on an asset's lifecycle — creation, transfer, document hash, status change. |
| **QTAG** | A physical NFC chip (NTAG 424 DNA) provisioned via commissioning and verified via SDM on every tap. |
| **Diamond Proxy** | A single \`POST /api/v1/diamond\` endpoint that routes to any Facet by selector (e.g. \`lifecycle.transition\`, \`escrow.lock\`). |

---

## Authentication

Every authenticated request requires an **\`X-API-Key\`** header:

\`\`\`
X-API-Key: qc_live_a3f9b2e1d4c7...
\`\`\`

Keys are generated via \`POST /api/v1/api-keys\` and come in three roles:

| Role | Can do |
|---|---|
| \`READER\` | Read assets, wallet balance, events |
| \`OPERATOR\` | Register assets, record events, initiate transfers |
| \`ADMIN\` | Everything above + manage tenants, API keys, circuit breaker |

⚠️ **Raw key values are shown exactly once** at creation time. Store them immediately in a secrets manager.

---

## Tenant isolation

Every resource — assets, API keys, events, devices, credits, QTAGs — is scoped to a single tenant and
never visible to other tenants, even if they share the same database instance. The tenant is derived
automatically from the authenticated API key; there is no tenant identifier to pass per-request.

Attempting to access a resource that belongs to a different tenant returns **403**, not 404, to prevent
enumeration. Cross-tenant operations do not exist in the public API — ownership transfers are mediated
through the Diamond Proxy transfer flow.

---

## Rate limits

Tenant-authenticated endpoints enforce **per-tenant, per-plan** quotas managed by \`RateLimiterFacet\`.
Every response from a rate-limited endpoint includes:

| Header | Description |
|---|---|
| \`X-RateLimit-Limit-Minute\` | Maximum requests allowed in the current 1-minute window |
| \`X-RateLimit-Remaining-Minute\` | Requests remaining in the current 1-minute window |
| \`X-RateLimit-Limit-Day\` | Daily request quota for the tenant's plan |
| \`X-RateLimit-Remaining-Day\` | Requests remaining today |

Session-based endpoints (auth routes) use **per-IP + per-email** limits via \`express-rate-limit\` and
return standard \`RateLimit-*\` headers (RFC 6585). Exceeding any limit returns \`429 Too Many Requests\`.

---

## Idempotency

All \`POST\` and \`PATCH\` mutating endpoints require an **\`Idempotency-Key\`** header (UUIDv4).
Re-sending the same key returns the original response without re-executing the operation — safe to retry on network failure.

\`\`\`
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
\`\`\`

---

## Quick start

1. **Create a tenant** → \`POST /api/v1/tenants\`
2. **Generate an API key** → \`POST /api/v1/api-keys\` (returns raw key once)
3. **Register an asset** → \`POST /api/v1/assets\`
4. **Verify a document** → \`GET /api/v1/public/verify/document/{sha3-512-hash}\` (no auth required)

---

## Key endpoints at a glance

| Area | Endpoints |
|---|---|
| Tenants | \`/api/v1/tenants\` |
| API Keys | \`/api/v1/api-keys\` |
| Assets | \`/api/v1/assets\` |
| Diamond Proxy | \`POST /api/v1/diamond\` — lifecycle, transfer, escrow, events, commissioning |
| Public verification | \`GET /api/v1/public/verify/document/{hash}\` |
| QTAG scan | \`GET /api/v1/scan\` |
| Wallet | \`/api/v1/wallet\` |
| Circuit Breaker | \`/api/v1/circuit-breaker\` *(internal — dev only)* |
      `,
      contact: {
        name: 'Quantum Cert',
        url: 'https://quantumcert.io',
      },
    },
    servers: process.env.NODE_ENV === 'production'
      ? [{ url: 'https://api.quantumcert.com.br', description: 'Production' }]
      : [{ url: 'http://localhost:3000', description: 'Development' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'A `qc_` prefixed API key generated via POST /api/v1/api-keys.',
        },
      },
      headers: {
        XRateLimitLimitMinute: {
          description: 'Maximum requests allowed in the current 1-minute window.',
          schema: { type: 'integer', example: 60 },
        },
        XRateLimitRemainingMinute: {
          description: 'Requests remaining in the current 1-minute window.',
          schema: { type: 'integer', example: 47 },
        },
        XRateLimitLimitDay: {
          description: 'Daily request quota for the tenant plan.',
          schema: { type: 'integer', example: 10000 },
        },
        XRateLimitRemainingDay: {
          description: 'Requests remaining today.',
          schema: { type: 'integer', example: 9823 },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid API key.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              examples: {
                missing_key: {
                  summary: 'API key not provided',
                  value: { success: false, error: 'Missing API key. Provide via X-API-Key header.' },
                },
                invalid_key: {
                  summary: 'API key is invalid',
                  value: { success: false, error: 'Invalid API key.', code: 'INVALID_KEY' },
                },
                key_revoked: {
                  summary: 'API key has been revoked',
                  value: { success: false, error: 'API key has been revoked.', code: 'KEY_REVOKED' },
                },
                key_expired: {
                  summary: 'API key has expired',
                  value: { success: false, error: 'API key has expired.', code: 'KEY_EXPIRED' },
                },
              },
            },
          },
        },
        BadRequest: {
          description: 'Invalid request payload.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              examples: {
                validation_error: {
                  summary: 'Schema validation failed (Zod)',
                  value: {
                    success: false,
                    error: 'Validation error.',
                    details: [
                      { path: 'metadata', message: 'Required' },
                    ],
                  },
                },
                invalid_payload: {
                  summary: 'Business-rule violation',
                  value: { success: false, error: 'Invalid or missing required fields.', code: 'INVALID_PROVIDER_PAYLOAD' },
                },
              },
            },
          },
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Invalid API key.' },
            code: {
              type: 'string',
              description: 'Machine-readable error code. Present on most 4xx responses.',
              example: 'INVALID_KEY',
            },
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
            id: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
            name: { type: 'string', example: 'Acme Corp' },
            slug: { type: 'string', example: 'acme-corp' },
            plan: { type: 'string', enum: ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'], example: 'PRO' },
            isActive: { type: 'boolean', example: true },
            status: { type: 'string', example: 'ACTIVE' },
            createdAt: { type: 'string', format: 'date-time', example: '2026-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', format: 'date-time', example: '2026-06-01T08:00:00.000Z' },
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
              example: 'PRO',
            },
          },
          example: {
            name: 'Acme Corp',
            plan: 'PRO',
          },
        },
        UpdateTenantPayload: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Acme Corp (Renamed)' },
            plan: { type: 'string', enum: ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'], example: 'ENTERPRISE' },
          },
          example: {
            name: 'Acme Corp (Renamed)',
            plan: 'ENTERPRISE',
          },
        },
        ApiKey: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
            tenantId: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
            keyPrefix: { type: 'string', example: 'qc_live_a3f9b2e1' },
            label: { type: 'string', example: 'Production integration key' },
            role: { type: 'string', enum: ['ADMIN', 'OPERATOR', 'READER'], example: 'OPERATOR' },
            scopes: { type: 'array', items: { type: 'string' }, example: ['assets:read', 'assets:write'] },
            isActive: { type: 'boolean', example: true },
            lastUsedAt: { type: 'string', format: 'date-time', nullable: true, example: '2026-06-28T14:22:00.000Z' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true, example: null },
            createdAt: { type: 'string', format: 'date-time', example: '2026-01-15T10:30:00.000Z' },
          },
        },
        GenerateApiKeyPayload: {
          type: 'object',
          required: ['tenantId', 'role'],
          properties: {
            tenantId: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
            label: { type: 'string', example: 'Production integration key' },
            role: { type: 'string', enum: ['ADMIN', 'OPERATOR', 'READER'], example: 'OPERATOR' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true, example: null },
          },
          example: {
            tenantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            label: 'Production integration key',
            role: 'OPERATOR',
          },
        },
        Asset: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            tenantId: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
            status: {
              type: 'string',
              enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BURNED', 'AWAITING_PAYMENT'],
              example: 'ACTIVE',
            },
            metadata: {
              type: 'object',
              description: 'Opaque JSON blob — the core does not interpret it, only validates its SHA3-512 hash.',
              example: { type: 'product', sku: 'SKU-001', serial: 'SN-XYZ-2026' },
            },
            signatureHash: {
              type: 'string',
              description: 'SHA3-512 hash of the metadata blob (128 hex chars).',
              example: 'a3f9b2e1d4c7f8091011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859606162636465',
            },
            createdAt: { type: 'string', format: 'date-time', example: '2026-03-10T09:15:00.000Z' },
            updatedAt: { type: 'string', format: 'date-time', example: '2026-06-20T17:45:00.000Z' },
          },
        },
        CreateAssetPayload: {
          type: 'object',
          required: ['metadata'],
          properties: {
            metadata: {
              type: 'object',
              description: 'Free-form JSON blob for the asset. Will be SHA3-512 hash-validated and stored immutably.',
              example: { type: 'product', sku: 'SKU-001', serial: 'SN-XYZ-2026', brand: 'Acme' },
            },
          },
          example: {
            metadata: {
              type: 'product',
              sku: 'SKU-001',
              serial: 'SN-XYZ-2026',
              brand: 'Acme',
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
              description: 'Target state. Invalid transitions return 422.',
              example: 'ACTIVE',
            },
            reason: { type: 'string', example: 'Product sold and delivered to buyer.' },
          },
          example: {
            targetStatus: 'ACTIVE',
            reason: 'Product sold and delivered to buyer.',
          },
        },
        TransferPayload: {
          type: 'object',
          required: ['newOwnerId'],
          properties: {
            newOwnerId: {
              type: 'string',
              format: 'uuid',
              description: 'ID of the new owner. Triggers a charge via BillingFacet.',
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          },
          example: {
            newOwnerId: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
        },
        DiamondCallPayload: {
          type: 'object',
          required: ['selector', 'payload'],
          properties: {
            selector: {
              type: 'string',
              example: 'lifecycle.transition',
              description: 'Selector in the format `FacetName.methodName` or `domain.action`.',
            },
            payload: {
              type: 'object',
              description: 'Payload forwarded directly to the selected Facet.',
            },
          },
          example: {
            selector: 'lifecycle.transition',
            payload: {
              assetId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              targetState: 'ACTIVE',
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: [
    ...publicRouteFiles,
    ...(isProduction ? [] : internalRouteFiles),
    path.resolve(__dirname, `../routes/index.${ext}`),
    path.resolve(__dirname, `../server.${ext}`),
  ],
};

let _cachedSpec: object | null = null;

export function getSpec(): object {
  // In dev, never cache so JSDoc changes are reflected immediately.
  if (process.env.NODE_ENV === 'production' && _cachedSpec) {
    return _cachedSpec;
  }
  _cachedSpec = swaggerJsdoc(options);
  return _cachedSpec;
}
