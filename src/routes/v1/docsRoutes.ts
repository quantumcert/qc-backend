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
