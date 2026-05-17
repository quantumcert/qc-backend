import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyRole } from '@prisma/client';
import { AuthenticatedRequest } from '../src/types';

const {
  mockApiRequestAudit,
  mockApiKey,
} = vi.hoisted(() => {
  const mockApiRequestAudit = {
    create: vi.fn(),
  };
  const mockApiKey = {
    update: vi.fn(),
  };

  return {
    mockApiRequestAudit,
    mockApiKey,
  };
});

vi.mock('../src/config/prisma', () => ({
  default: {
    apiRequestAudit: mockApiRequestAudit,
    apiKey: mockApiKey,
  },
}));

import { apiRequestAudit } from '../src/middleware/apiRequestAudit';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(apiRequestAudit);

  app.post('/api/v1/diamond', (req: AuthenticatedRequest, res) => {
    req.tenantId = 'tenant-a';
    req.apiKeyId = 'api-key-a';
    req.apiKeyPrefix = 'qc_test_prefix01';
    req.apiKeyRole = ApiKeyRole.OPERATOR;
    req.correlationId = 'corr-from-auth';

    res.status(201).json({ success: true });
  });

  app.post('/api/v1/diamond-error', (req: AuthenticatedRequest, res) => {
    req.tenantId = 'tenant-a';
    req.apiKeyId = 'api-key-a';
    req.apiKeyPrefix = 'qc_test_prefix01';
    req.apiKeyRole = ApiKeyRole.OPERATOR;
    req.correlationId = 'corr-error';
    req.apiRequestAuditError = 'Invalid payload for qc_test_secret_should_not_leak';

    res.status(422).json({ success: false, error: 'Invalid payload' });
  });

  app.get('/api/v1/public/asset/:id', (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

async function flushAuditPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('apiRequestAudit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApiRequestAudit.create.mockResolvedValue({ id: 'audit-1' });
    mockApiKey.update.mockResolvedValue({ id: 'api-key-a' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists sanitized API-key request metadata without raw key or body payload', async () => {
    const rawKey = 'qc_test_secret_should_not_leak';

    await request(createApp())
      .post('/api/v1/diamond?debug=true')
      .set('X-API-Key', rawKey)
      .send({
        selector: 'asset.create',
        payload: {
          privateDocument: rawKey,
          nested: { sensitive: 'body-secret' },
        },
      })
      .expect(201);

    await flushAuditPromises();

    expect(mockApiRequestAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        apiKeyId: 'api-key-a',
        keyPrefix: 'qc_test_prefix01',
        role: ApiKeyRole.OPERATOR,
        method: 'POST',
        path: '/api/v1/diamond',
        selector: 'asset.create',
        statusCode: 201,
        correlationId: 'corr-from-auth',
      }),
    });
    expect(mockApiKey.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'api-key-a' },
      data: { lastUsedAt: expect.any(Date) },
    }));

    const auditPayload = JSON.stringify(mockApiRequestAudit.create.mock.calls[0][0].data);
    expect(auditPayload).not.toContain(rawKey);
    expect(auditPayload).not.toContain('body-secret');
    expect(auditPayload).not.toContain('payload');
    expect(auditPayload).not.toContain('x-api-key');
  });

  it('records failed requests with status and redacted sanitized error', async () => {
    await request(createApp())
      .post('/api/v1/diamond-error')
      .send({ selector: 'event.recordAuthenticated' })
      .expect(422);

    await flushAuditPromises();

    expect(mockApiRequestAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        statusCode: 422,
        selector: 'event.recordAuthenticated',
        sanitizedError: 'Invalid payload for [REDACTED_API_KEY]',
        correlationId: 'corr-error',
      }),
    });
  });

  it('does not audit anonymous public routes', async () => {
    await request(createApp())
      .get('/api/v1/public/asset/qc-public-1')
      .expect(200);

    await flushAuditPromises();

    expect(mockApiRequestAudit.create).not.toHaveBeenCalled();
    expect(mockApiKey.update).not.toHaveBeenCalled();
  });

  it('does not block the main response when audit persistence fails', async () => {
    mockApiRequestAudit.create.mockRejectedValueOnce(new Error('database unavailable'));

    await request(createApp())
      .post('/api/v1/diamond')
      .send({ selector: 'asset.create' })
      .expect(201);

    await flushAuditPromises();

    expect(mockApiRequestAudit.create).toHaveBeenCalled();
  });
});
