import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../src/types';

const { mockAgent, mockEventLog } = vi.hoisted(() => ({
  mockAgent: { findFirst: vi.fn() },
  mockEventLog: { create: vi.fn(), findUnique: vi.fn() },
}));

vi.mock('../src/config/prisma', () => ({
  default: {
    agent: mockAgent,
    eventLog: mockEventLog,
  },
}));

// We mock PostQuantumCrypto to control verify output
vi.mock('../src/utils/PostQuantumCrypto', () => ({
  PostQuantumCrypto: {
    verifySignatureFalcon512: vi.fn(),
  },
}));

vi.mock('../src/diamond/FacetRegistry', () => ({
  FacetRegistry: {
    'event.recordAuthenticated': vi.fn(),
  },
}));

import { requireAgentSignature } from '../src/middleware/requireAgentSignature';
import { PostQuantumCrypto } from '../src/utils/PostQuantumCrypto';
import { AgentController } from '../src/controllers/AgentController';
import { FacetRegistry } from '../src/diamond/FacetRegistry';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
};

const mockNext = vi.fn() as unknown as NextFunction;

const validAgent = {
  id: 'agt-1',
  tenantId: 'tenant-1',
  publicKeyFalcon: 'pubkeyB64==',
  allowedSelectors: ['event.recordAuthenticated'],
  isActive: true,
};

const makeReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
  ({
    tenantId: 'tenant-1',
    apiKeyId: 'apk-1',
    apiKeyRole: 'OPERATOR',
    body: {
      selector: 'event.recordAuthenticated',
      assetId: 'asset-1',
      payload: { note: 'test' },
      signature: 'validSigB64==',
    },
    ...overrides,
  } as unknown as AuthenticatedRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAgentSignature', () => {
  it('calls next() and injects agentId when everything is valid', async () => {
    mockAgent.findFirst.mockResolvedValue(validAgent);
    vi.mocked(PostQuantumCrypto.verifySignatureFalcon512).mockResolvedValue(true);
    const req = makeReq();
    const res = mockRes();
    await requireAgentSignature(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
    expect(req.agentId).toBe('agt-1');
  });

  it('returns 403 NOT_AN_AGENT when apiKeyId has no linked agent', async () => {
    mockAgent.findFirst.mockResolvedValue(null);
    const req = makeReq();
    const res = mockRes();
    await requireAgentSignature(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_AN_AGENT' })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 AGENT_REVOKED when agent.isActive is false', async () => {
    mockAgent.findFirst.mockResolvedValue({ ...validAgent, isActive: false });
    const req = makeReq();
    const res = mockRes();
    await requireAgentSignature(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AGENT_REVOKED' })
    );
  });

  it('returns 403 INVALID_AGENT_SIGNATURE when Falcon-512 verification fails', async () => {
    mockAgent.findFirst.mockResolvedValue(validAgent);
    vi.mocked(PostQuantumCrypto.verifySignatureFalcon512).mockResolvedValue(false);
    const req = makeReq();
    const res = mockRes();
    await requireAgentSignature(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INVALID_AGENT_SIGNATURE' })
    );
  });

  it('returns 403 SELECTOR_NOT_ALLOWED when selector is not in allowedSelectors', async () => {
    mockAgent.findFirst.mockResolvedValue(validAgent);
    vi.mocked(PostQuantumCrypto.verifySignatureFalcon512).mockResolvedValue(true);
    const req = makeReq({
      body: {
        selector: 'lifecycle.transition', // not in allowedSelectors
        assetId: 'asset-1',
        payload: {},
        signature: 'sig',
      },
    } as any);
    const res = mockRes();
    await requireAgentSignature(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SELECTOR_NOT_ALLOWED' })
    );
  });
});

// ─────────────────────────────────────────────────────────
// AgentController.handleEvent
// ─────────────────────────────────────────────────────────

describe('AgentController.handleEvent', () => {
  const makeControllerReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
    ({
      tenantId: 'tenant-1',
      apiKeyId: 'apk-1',
      apiKeyRole: 'OPERATOR',
      agentId: 'agt-1',
      body: {
        selector: 'event.recordAuthenticated',
        assetId: 'asset-1',
        payload: { note: 'sensor reading' },
        signature: 'sig',
      },
      ...overrides,
    } as unknown as AuthenticatedRequest);

  beforeEach(() => vi.clearAllMocks());

  it('executes the facet and returns 200 with result', async () => {
    vi.mocked(FacetRegistry['event.recordAuthenticated']).mockResolvedValue({ id: 'evt-1' });
    const req = makeControllerReq();
    const res = mockRes();
    await AgentController.handleEvent(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { id: 'evt-1' } })
    );
  });

  it('returns 400 UNKNOWN_SELECTOR for unregistered selectors', async () => {
    const req = makeControllerReq({
      body: {
        selector: 'does.not.exist',
        assetId: 'asset-1',
        payload: {},
        signature: 'sig',
      },
    } as any);
    const res = mockRes();
    await AgentController.handleEvent(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNKNOWN_SELECTOR' })
    );
  });

  it('returns 400 SELECTOR_REQUIRED when selector is missing', async () => {
    const req = makeControllerReq({
      body: { assetId: 'asset-1', payload: {}, signature: 'sig' },
    } as any);
    const res = mockRes();
    await AgentController.handleEvent(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SELECTOR_REQUIRED' })
    );
  });

  it('passes agentId in secureContext to the facet', async () => {
    const facetSpy = vi.mocked(FacetRegistry['event.recordAuthenticated']).mockResolvedValue({});
    const req = makeControllerReq();
    const res = mockRes();
    await AgentController.handleEvent(req, res);
    expect(facetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt-1' }),
      expect.any(Object)
    );
  });

  it('returns 400 with business error code when facet throws a known error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(FacetRegistry['event.recordAuthenticated']).mockRejectedValue(
      Object.assign(new Error('Asset not found'), { code: 'ASSET_NOT_FOUND' })
    );
    const req = makeControllerReq();
    const res = mockRes();
    await AgentController.handleEvent(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ASSET_NOT_FOUND' })
    );
    consoleSpy.mockRestore();
  });

  it('returns 500 E500 when facet throws an untyped error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(FacetRegistry['event.recordAuthenticated']).mockRejectedValue(
      new Error('unexpected db failure') // no .code property
    );
    const req = makeControllerReq();
    const res = mockRes();
    await AgentController.handleEvent(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'E500' })
    );
    consoleSpy.mockRestore();
  });
});
