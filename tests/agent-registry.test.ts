import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAgent, mockApiKey, mockTenant, mockAuditLog } = vi.hoisted(() => ({
  mockAgent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  mockApiKey: {
    create: vi.fn(),
    update: vi.fn(),
  },
  mockTenant: {
    findUnique: vi.fn(),
  },
  mockAuditLog: {
    create: vi.fn(),
  },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    agent: mockAgent,
    apiKey: mockApiKey,
    tenant: mockTenant,
    auditLog: mockAuditLog,
    $transaction: vi.fn(async (cb) =>
      cb({ agent: mockAgent, apiKey: mockApiKey, auditLog: mockAuditLog })
    ),
  },
}));

import { AgentRegistryFacet, AgentError } from '../src/services/core-facets/AgentRegistryFacet';

const ctx = { tenantId: 'tenant-1', apiKeyId: 'key-1', role: 'ADMIN' as const };
const otherCtx = { tenantId: 'tenant-2', apiKeyId: 'key-2', role: 'ADMIN' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockTenant.findUnique.mockResolvedValue({ id: 'tenant-1', isActive: true });
});

describe('AgentRegistryFacet.register', () => {
  it('creates an Agent and linked ApiKey, returns rawApiKey', async () => {
    mockApiKey.create.mockResolvedValue({ id: 'apk-1', keyPrefix: 'qc_test_ab12' });
    const createdAgent = { id: 'agt-1', name: 'Robot A', allowedSelectors: ['event.recordAuthenticated'] };
    mockAgent.create.mockResolvedValue(createdAgent);

    const result = await AgentRegistryFacet.register(ctx, {
      name: 'Robot A',
      publicKeyFalcon: Buffer.from('fakepubkey').toString('base64'),
      allowedSelectors: ['event.recordAuthenticated'],
    });

    expect(result.agentId).toBe('agt-1');
    expect(result.rawApiKey).toMatch(/^qc_(test|live)_/);
    expect(mockAgent.create).toHaveBeenCalledOnce();
  });

  it('throws TENANT_NOT_FOUND when tenant does not exist', async () => {
    mockTenant.findUnique.mockResolvedValue(null);
    await expect(
      AgentRegistryFacet.register(ctx, {
        name: 'Bot',
        publicKeyFalcon: 'abc',
        allowedSelectors: [],
      })
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('throws INVALID_PUBLIC_KEY when publicKeyFalcon is not valid base64', async () => {
    await expect(
      AgentRegistryFacet.register(ctx, {
        name: 'Bot',
        publicKeyFalcon: '!!!not-base64!!!',
        allowedSelectors: ['event.recordAuthenticated'],
      })
    ).rejects.toMatchObject({ code: 'INVALID_PUBLIC_KEY' });
  });

  it('throws INSUFFICIENT_PERMISSIONS when role is OPERATOR', async () => {
    const opCtx = { ...ctx, role: 'OPERATOR' as const };
    await expect(
      AgentRegistryFacet.register(opCtx, {
        name: 'Bot',
        publicKeyFalcon: Buffer.from('key').toString('base64'),
        allowedSelectors: [],
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });
});

describe('AgentRegistryFacet.revoke', () => {
  it('sets isActive=false on Agent and ApiKey atomically', async () => {
    mockAgent.findFirst.mockResolvedValue({
      id: 'agt-1',
      tenantId: 'tenant-1',
      isActive: true,
      apiKeyId: 'apk-1',
    });
    mockAgent.update.mockResolvedValue({ id: 'agt-1', isActive: false });
    mockApiKey.update.mockResolvedValue({ id: 'apk-1', isActive: false });

    const result = await AgentRegistryFacet.revoke(ctx, { agentId: 'agt-1' });

    expect(result).toEqual({ revoked: true });
    expect(mockAgent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agt-1' }, data: { isActive: false } })
    );
    expect(mockApiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'apk-1' } })
    );
  });

  it('throws AGENT_NOT_FOUND when agentId belongs to another tenant', async () => {
    mockAgent.findFirst.mockResolvedValue(null);
    await expect(
      AgentRegistryFacet.revoke(otherCtx, { agentId: 'agt-1' })
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('throws AGENT_ALREADY_REVOKED when agent is already inactive', async () => {
    mockAgent.findFirst.mockResolvedValue({
      id: 'agt-1',
      tenantId: 'tenant-1',
      isActive: false,
      apiKeyId: 'apk-1',
    });
    await expect(
      AgentRegistryFacet.revoke(ctx, { agentId: 'agt-1' })
    ).rejects.toMatchObject({ code: 'AGENT_ALREADY_REVOKED' });
  });
});

describe('AgentRegistryFacet.status', () => {
  it('returns agent data for the correct tenant', async () => {
    const agent = { id: 'agt-1', tenantId: 'tenant-1', name: 'Bot', isActive: true };
    mockAgent.findFirst.mockResolvedValue(agent);
    const result = await AgentRegistryFacet.status(ctx, { agentId: 'agt-1' });
    expect(result).toEqual(agent);
  });

  it('throws AGENT_NOT_FOUND when agentId belongs to another tenant', async () => {
    mockAgent.findFirst.mockResolvedValue(null);
    await expect(
      AgentRegistryFacet.status(otherCtx, { agentId: 'agt-1' })
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });
});
