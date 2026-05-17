import { describe, expect, it, vi } from 'vitest';
import { requireApiKeyScope } from '../src/middleware/apiKeyScopeGuard';

describe('requireApiKeyScope', () => {
  it('allows authenticated API keys that contain the required scope', () => {
    const req = { apiKeyId: 'api-key-1', apiKeyScopes: ['assets:read'] };
    const res = buildResponse();
    const next = vi.fn();

    requireApiKeyScope('assets:read')(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks authenticated API keys that do not contain the required scope', () => {
    const req = { apiKeyId: 'api-key-1', apiKeyScopes: ['assets:read'] };
    const res = buildResponse();
    const next = vi.fn();

    requireApiKeyScope('assets:write')(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'API_KEY_SCOPE_DENIED',
    }));
  });
});

function buildResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}
