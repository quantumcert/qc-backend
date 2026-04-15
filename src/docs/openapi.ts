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
