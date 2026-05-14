// tests/docs.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import supertest from 'supertest';

// Minimal Prisma mock to avoid a real CI connection.
vi.mock('../src/config/prisma', () => ({
  default: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

// SchedulerService mock to avoid cron jobs in tests.
vi.mock('../src/services/SchedulerService', () => ({
  SchedulerService: { start: vi.fn() },
}));

let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  const { app } = await import('../src/server');
  request = supertest(app);
});

describe('GET /api-docs/spec.json', () => {
  it('returns status 200', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.status).toBe(200);
  });

  it('returns Content-Type application/json', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns a valid OpenAPI 3.0 spec', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Quantum Cert Diamond API');
    expect(res.body.info.version).toBe('3.0.0');
    expect(res.body.components.securitySchemes.ApiKeyAuth).toBeDefined();
  });

  it('exposes API paths', async () => {
    const res = await request.get('/api-docs/spec.json');
    expect(res.body.paths).toBeDefined();
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(0);
  });

  it('preserves accented documentation text', async () => {
    const res = await request.get('/api-docs/spec.json');
    const documentVerification =
      res.body.paths['/api/v1/public/verify/document/{hash}'].get.description;

    expect(documentVerification).toContain('Endpoint público');
    expect(documentVerification).toContain('sem autenticação');
    expect(documentVerification).toContain('verificação documental');
  });

  it('documents every public product route mounted in Express', async () => {
    const res = await request.get('/api-docs/spec.json');
    const paths = res.body.paths;

    [
      '/health',
      '/api/v1/diamond',
      '/api/v1/scan',
      '/api/v1/agent/event',
      '/api/v1/api-keys',
      '/api/v1/api-keys/{id}',
      '/api/v1/api-keys/{id}/rotate',
      '/api/v1/api-keys/{tenantId}',
      '/api/v1/assets',
      '/api/v1/assets/{assetId}/transfer',
      '/api/v1/assets/{id}',
      '/api/v1/assets/{id}/owners',
      '/api/v1/circuit-breaker/pause',
      '/api/v1/circuit-breaker/pause-all',
      '/api/v1/circuit-breaker/resume',
      '/api/v1/circuit-breaker/status',
      '/api/v1/contributions/{id}/review',
      '/api/v1/devices',
      '/api/v1/devices/tap',
      '/api/v1/public/asset/{assetId}/contribution',
      '/api/v1/public/asset/{id}',
      '/api/v1/public/asset/{id}/contact',
      '/api/v1/public/verify/document/{hash}',
      '/api/v1/tenants',
      '/api/v1/tenants/{id}',
      '/api/v1/tenants/{id}/deactivate',
      '/api/v1/tenants/{id}/reactivate',
      '/api/v1/tenants/{id}/usage',
      '/api/v1/wallet/account',
      '/api/v1/wallet/balance',
      '/api/v1/wallet/deposit-address',
      '/api/v1/webhooks/mercadopago',
    ].forEach((path) => {
      expect(paths[path], `Missing OpenAPI path: ${path}`).toBeDefined();
    });
  });

  it('documents public document verification and QTAG contracts', async () => {
    const res = await request.get('/api-docs/spec.json');

    expect(res.body.paths['/api/v1/public/verify/document/{hash}']).toBeDefined();
    expect(res.body.paths['/api/v1/scan']).toBeDefined();

    const scan = res.body.paths['/api/v1/scan'].get;
    expect(scan.security).toEqual([]);
    expect(scan.parameters.map((p: any) => p.name)).toEqual(
      expect.arrayContaining(['p', 'm', 'uid', 'lat', 'lon'])
    );
    expect(scan.responses['200']).toBeDefined();
    expect(scan.responses['403']).toBeDefined();
    expect(scan.responses['400']).toBeDefined();
  });

  it('documents Diamond selectors for document verification and QTAG', async () => {
    const res = await request.get('/api-docs/spec.json');
    const examples =
      res.body.paths['/api/v1/diamond'].post.requestBody.content['application/json'].examples;

    expect(examples.eventRecordAuthenticatedDocument.value.selector).toBe(
      'event.recordAuthenticated'
    );
    expect(examples.commissioningStart.value.selector).toBe('commissioning.start');
    expect(examples.commissioningConfirm.value.selector).toBe('commissioning.confirm');
    expect(examples.commissioningStatus.value.selector).toBe('commissioning.status');
  });
});

describe('GET /api-docs', () => {
  it('returns status 200', async () => {
    const res = await request.get('/api-docs');
    expect(res.status).toBe(200);
  });

  it('returns HTML with Scalar UI', async () => {
    const res = await request.get('/api-docs');
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Quantum Cert Diamond API');
  });
});
