// src/routes/v1/docsRoutes.ts
// ═══════════════════════════════════════════════════════════
// DOCS ROUTES — Scalar API Reference
//
// GET /api-docs              → Scalar UI (HTML interativo)
// GET /api-docs/spec.json    → Spec OpenAPI 3.0 em JSON
// GET /api-docs/standalone.js → Bundle Scalar servido localmente
//
// O bundle é servido do node_modules sem depender de CDN externo.
// ═══════════════════════════════════════════════════════════

import path from 'path';
import { Router, Request, Response } from 'express';
import { getSpec } from '../../docs/openapi';

const router = Router();

// Bundle Scalar — servido localmente a partir do node_modules
const scalarBundlePath = path.resolve(
  __dirname,
  '../../../node_modules/@scalar/api-reference/dist/browser/standalone.js',
);

router.get('/api-docs/standalone.js', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(scalarBundlePath);
});

// Spec JSON bruta — consumida pelo Scalar e por ferramentas externas
router.get('/api-docs/spec.json', (_req: Request, res: Response) => {
  res.json(getSpec());
});

// UI Scalar interativa — sem dependência de CDN externo
router.get('/api-docs', (_req: Request, res: Response) => {
  // Pré-preenche a chave se definida — só coloque DOCS_DEFAULT_API_KEY em dev/.env
  const apiKey = process.env.DOCS_DEFAULT_API_KEY ?? '';

  const config = JSON.stringify({
    spec: { url: '/api-docs/spec.json' },
    theme: 'default',
    authentication: {
      preferredSecurityScheme: 'ApiKeyAuth',
      apiKey: { token: apiKey },
    },
  });

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html>
  <head>
    <title>Quantum Cert Diamond API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/api-docs/standalone.js"></script>
    <script>
      Scalar.createApiReference('#app', ${config});
    </script>
  </body>
</html>`);
});

export default router;
