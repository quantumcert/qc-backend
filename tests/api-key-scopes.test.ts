import { describe, expect, it } from 'vitest';
import { ApiKeyRole } from '@prisma/client';
import {
  assertApiKeyCanAccessSelector,
  resolveEffectiveApiKeyScopes,
  resolveScopeForSelector,
} from '../src/security/apiKeyScopes';

describe('API key scope policy', () => {
  it('maps Diamond selectors to canonical API key scopes', () => {
    expect(resolveScopeForSelector('asset.get')).toBe('assets:read');
    expect(resolveScopeForSelector('asset.create')).toBe('assets:write');
    expect(resolveScopeForSelector('event.recordAuthenticated')).toBe('events:write');
    expect(resolveScopeForSelector('commissioning.status')).toBe('qtags:read');
    expect(resolveScopeForSelector('commissioning.start')).toBe('qtags:write');
    expect(resolveScopeForSelector('transfer.initiate')).toBe('transfers:write');
    expect(resolveScopeForSelector('escrow.status')).toBe('escrow:read');
    expect(resolveScopeForSelector('escrow.lock')).toBe('escrow:write');
  });

  it('denies selector execution when the API key does not include the required scope', () => {
    expect(() => assertApiKeyCanAccessSelector('asset.create', ['assets:read']))
      .toThrowError(/requires scope assets:write/i);
  });

  it('allows selector execution when the API key includes the required scope', () => {
    expect(() => assertApiKeyCanAccessSelector('asset.create', ['assets:write']))
      .not.toThrow();
  });

  it('resolves role defaults for legacy API keys without explicit scopes', () => {
    const readerScopes = resolveEffectiveApiKeyScopes(undefined, ApiKeyRole.READER);
    const operatorScopes = resolveEffectiveApiKeyScopes(undefined, ApiKeyRole.OPERATOR);

    expect(() => assertApiKeyCanAccessSelector('asset.get', readerScopes)).not.toThrow();
    expect(() => assertApiKeyCanAccessSelector('asset.create', readerScopes))
      .toThrowError(/requires scope assets:write/i);
    expect(() => assertApiKeyCanAccessSelector('lifecycle.transition', operatorScopes)).not.toThrow();
  });
});
