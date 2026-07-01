// src/docs/openapi.ts
// ═══════════════════════════════════════════════════════════
// OPENAPI SPEC CONFIG — swagger-jsdoc
// Gera a spec OpenAPI 3.0 em memória a partir dos blocos
// @openapi nos arquivos de rota.
// ═══════════════════════════════════════════════════════════

import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

// In production the compiled file lives at dist/docs/openapi.js, so __dirname
// points into dist/. In dev (tsx) it points into src/. Detect and use correct ext.
const isProd = __dirname.includes(`${path.sep}dist${path.sep}`) || __dirname.endsWith(`${path.sep}dist`);
const ext = isProd ? 'js' : 'ts';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Quantum Cert Diamond API',
      version: '3.0.0',
      description:
        'Universal multi-tenant API built on the EIP-2535 Diamond Pattern. ' +
        'All authenticated endpoints require an `X-API-Key` header with a `qc_` prefixed key. ' +
        'Mutating endpoints (POST, PATCH) require an `Idempotency-Key` (UUIDv4) header.',
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
          description: 'qc_ prefixed API key generated via POST /api/v1/api-keys.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Descriptive error message' },
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
            name: { type: 'string', example: 'Production key' },
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
            name: { type: 'string', example: 'Integration key' },
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
    path.resolve(__dirname, `../routes/v1/*.${ext}`),
    path.resolve(__dirname, `../routes/index.${ext}`),
    path.resolve(__dirname, `../server.${ext}`),
  ],
};

let _cachedSpec: object | null = null;

export function getSpec(): object {
  // Em dev, nunca cacheia para refletir mudanças nos JSDocs imediatamente
  if (process.env.NODE_ENV === 'production' && _cachedSpec) {
    return _cachedSpec;
  }
  _cachedSpec = swaggerJsdoc(options);
  return _cachedSpec;
}
