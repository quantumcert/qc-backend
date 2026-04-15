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
