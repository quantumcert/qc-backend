# M2M / Agent Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar robôs e dispositivos IoT a se autenticar e emitir eventos via `POST /api/v1/agent/event`, com identidade de máquina rastreável, assinatura Falcon-512 por payload e permissões granulares por seletor.

**Architecture:** `Agent` é uma entidade separada de `Device`. Um Agent é criado por um ADMIN via DiamondProxy (`agent.register`), recebe uma ApiKey gerada atomicamente, e se autentica com essa ApiKey + assinatura Falcon-512 do payload em cada chamada. O `AgentController` executa o seletor diretamente no `FacetRegistry`, sem round-trip HTTP.

**Tech Stack:** Node.js + TypeScript, Prisma (PostgreSQL), Express, vitest, falcon-crypto (já instalado)

---

## File Map

**Created:**
- `src/services/core-facets/AgentRegistryFacet.ts` — seletores `agent.register`, `agent.revoke`, `agent.status`
- `src/middleware/requireAgentSignature.ts` — valida Falcon-512 + allowedSelectors, injeta `agentId` no req
- `src/routes/v1/agentRoutes.ts` — `POST /api/v1/agent/event`
- `src/controllers/AgentController.ts` — orquestra middleware → FacetRegistry → resposta
- `tests/agent-registry.test.ts` — testes unitários do AgentRegistryFacet
- `tests/agent-event.test.ts` — testes do middleware requireAgentSignature e AgentController

**Modified:**
- `prisma/schema.prisma` — modelo `Agent`, back-reference `agent Agent?` em `ApiKey`
- `src/utils/PostQuantumCrypto.ts` — adicionar `verifySignatureFalcon512`
- `src/types/index.ts` — adicionar `agentId?` em `AuthenticatedRequest`
- `src/diamond/FacetRegistry.ts` — seletores `agent.register`, `agent.revoke`, `agent.status`
- `src/routes/index.ts` — montar `agentRoutes` em `/v1/agents`

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar modelo Agent e back-reference em ApiKey**

Em `prisma/schema.prisma`, imediatamente após o modelo `ApiKey` (após a chave do enum `ApiKeyRole`), adicione:

```prisma
// ═══════════════════════════════════════════════════════════
// AGENT — Machine Identity for M2M / IoT
// Separate from Device (NFC hardware). Agent is a software
// identity that authenticates via ApiKey + Falcon-512 signature.
// ═══════════════════════════════════════════════════════════
model Agent {
  id          String  @id @default(cuid())
  tenantId    String
  tenant      Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name        String
  description String?

  // Falcon-512 public key in base64 — verifies payload signatures
  publicKeyFalcon  String
  // Selectors this agent is allowed to execute (e.g. ["event.recordAuthenticated"])
  allowedSelectors String[]

  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // FK to the ApiKey created at registration time (role: OPERATOR)
  apiKeyId String? @unique
  apiKey   ApiKey? @relation(fields: [apiKeyId], references: [id])

  @@index([tenantId])
}
```

No modelo `ApiKey`, adicione a back-reference **antes** do `@@index([tenantId])`:

```prisma
  // Back-reference for Agent — FK lives in Agent.apiKeyId, no extra column here
  agent Agent?
```

No modelo `Tenant`, adicione a back-reference para Agent **antes** do `@@index` final:

```prisma
  agents Agent[]
```

- [ ] **Step 2: Criar e aplicar a migration**

```bash
npm run db:migrate
```

Quando o CLI perguntar o nome da migration, responda: `add_agent_model`

Expected output: `The following migration(s) have been applied: .../add_agent_model/migration.sql`

- [ ] **Step 3: Regenerar o Prisma client**

```bash
npm run db:generate
```

Expected output: `Generated Prisma Client`

- [ ] **Step 4: Verificar que o build compila**

```bash
npm run build 2>&1 | tail -5
```

Expected output: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(agent): add Agent model to schema with Falcon-512 public key and allowedSelectors"
```

---

## Task 2: PostQuantumCrypto.verifySignatureFalcon512

**Files:**
- Modify: `src/utils/PostQuantumCrypto.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/post-quantum-crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// We test against the real falcon-crypto WASM — no mocks.
describe('PostQuantumCrypto.verifySignatureFalcon512', () => {
  it('returns true for a valid signature', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const falcon = require('falcon-crypto');
    const { publicKey, privateKey } = await falcon.keyPair();
    const message = JSON.stringify({ selector: 'event.recordAuthenticated', assetId: 'a1' });
    const sig = await falcon.signDetached(Buffer.from(message), privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const pubB64 = Buffer.from(publicKey).toString('base64');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(message, sigB64, pubB64);
    expect(result).toBe(true);
  });

  it('returns false for a tampered message', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const falcon = require('falcon-crypto');
    const { publicKey, privateKey } = await falcon.keyPair();
    const message = JSON.stringify({ selector: 'event.recordAuthenticated', assetId: 'a1' });
    const sig = await falcon.signDetached(Buffer.from(message), privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const pubB64 = Buffer.from(publicKey).toString('base64');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(
      message + ' tampered',
      sigB64,
      pubB64
    );
    expect(result).toBe(false);
  });

  it('returns false for a wrong public key', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const falcon = require('falcon-crypto');
    const kp1 = await falcon.keyPair();
    const kp2 = await falcon.keyPair();
    const message = 'hello';
    const sig = await falcon.signDetached(Buffer.from(message), kp1.privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const wrongPubB64 = Buffer.from(kp2.publicKey).toString('base64');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(message, sigB64, wrongPubB64);
    expect(result).toBe(false);
  });

  it('returns false for malformed base64 inputs', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(
      'msg',
      'not-valid-base64!!!',
      'also-not-valid!!!'
    );
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
npx vitest run tests/post-quantum-crypto.test.ts 2>&1 | tail -15
```

Expected: FAIL — `PostQuantumCrypto.verifySignatureFalcon512 is not a function`

- [ ] **Step 3: Implementar o método**

Em `src/utils/PostQuantumCrypto.ts`, adicione após o método `zeroize`:

```typescript
    // ============================================================
    // SIGNATURE VERIFICATION
    // Verifies a Falcon-512 detached signature against a public key.
    // Both signature and publicKey are base64-encoded.
    // Returns false on any error (invalid inputs, wrong key, tampered message).
    // ============================================================
    static async verifySignatureFalcon512(
        message: string,
        signatureB64: string,
        publicKeyB64: string
    ): Promise<boolean> {
        try {
            const messageBytes = Buffer.from(message);
            const signature = Buffer.from(signatureB64, 'base64');
            const publicKey = Buffer.from(publicKeyB64, 'base64');
            // openDetached throws if signature is invalid
            await falcon.openDetached(signature, messageBytes, publicKey);
            return true;
        } catch {
            return false;
        }
    }
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
npx vitest run tests/post-quantum-crypto.test.ts 2>&1 | tail -10
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/utils/PostQuantumCrypto.ts tests/post-quantum-crypto.test.ts
git commit -m "feat(agent): add verifySignatureFalcon512 to PostQuantumCrypto"
```

---

## Task 3: AgentRegistryFacet (TDD)

**Files:**
- Create: `src/services/core-facets/AgentRegistryFacet.ts`
- Create: `tests/agent-registry.test.ts`

- [ ] **Step 1: Escrever o arquivo de testes**

Crie `tests/agent-registry.test.ts`:

```typescript
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
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
npx vitest run tests/agent-registry.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../src/services/core-facets/AgentRegistryFacet'`

- [ ] **Step 3: Implementar AgentRegistryFacet**

Crie `src/services/core-facets/AgentRegistryFacet.ts`:

```typescript
// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: AgentRegistryFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Responsibility: Register, revoke, and query machine identities
// (robots / IoT devices) that authenticate via ApiKey + Falcon-512.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/prisma';
import { ApiKeyRole } from '@prisma/client';

interface SecureContext {
  tenantId: string;
  apiKeyId: string;
  role: ApiKeyRole;
}

export class AgentRegistryFacet {

  // ─── REGISTER ────────────────────────────────────────────
  // Creates an Agent + linked ApiKey in one transaction.
  // Returns rawApiKey ONCE — it cannot be recovered later.
  static async register(
    secureContext: SecureContext,
    payload: {
      name: string;
      description?: string;
      publicKeyFalcon: string; // base64-encoded Falcon-512 public key
      allowedSelectors: string[];
    }
  ): Promise<{ agentId: string; rawApiKey: string }> {
    const { tenantId, role } = secureContext;
    const { name, description, publicKeyFalcon, allowedSelectors } = payload;

    if (role !== 'ADMIN') {
      throw new AgentError('INSUFFICIENT_PERMISSIONS', 'Only ADMIN can register agents.');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AgentError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
    if (!tenant.isActive) throw new AgentError('TENANT_INACTIVE', 'Tenant is inactive.');

    // Validate publicKeyFalcon is valid base64
    const decoded = Buffer.from(publicKeyFalcon, 'base64');
    if (decoded.toString('base64') !== publicKeyFalcon) {
      throw new AgentError('INVALID_PUBLIC_KEY', 'publicKeyFalcon must be a valid base64 string.');
    }

    // Generate ApiKey material inline (same as ApiKeyManagementFacet pattern)
    const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
    const rawApiKey = `qc_${env}_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawApiKey, 10);
    const keyPrefix = rawApiKey.substring(0, 16);

    const agent = await prisma.$transaction(async (tx) => {
      const newApiKey = await (tx as any).apiKey.create({
        data: {
          tenantId,
          keyHash,
          keyPrefix,
          label: `agent:${name}`,
          role: ApiKeyRole.OPERATOR,
        },
      });

      const newAgent = await (tx as any).agent.create({
        data: {
          tenantId,
          name,
          description,
          publicKeyFalcon,
          allowedSelectors,
          apiKeyId: newApiKey.id,
        },
      });

      await (tx as any).auditLog.create({
        data: {
          tenantId,
          apiKeyPrefix: keyPrefix,
          action: 'AGENT_REGISTERED',
          resourceType: 'AGENT',
          resourceId: newAgent.id,
          metadata: { name, allowedSelectors },
        },
      });

      return newAgent;
    });

    return { agentId: agent.id, rawApiKey };
  }

  // ─── REVOKE ───────────────────────────────────────────────
  // Deactivates Agent + ApiKey atomically. Irreversible (re-register to restore).
  static async revoke(
    secureContext: SecureContext,
    payload: { agentId: string }
  ): Promise<{ revoked: true }> {
    const { tenantId } = secureContext;

    const agent = await prisma.agent.findFirst({
      where: { id: payload.agentId, tenantId },
    });

    if (!agent) throw new AgentError('AGENT_NOT_FOUND', 'Agent not found for this tenant.');
    if (!agent.isActive) throw new AgentError('AGENT_ALREADY_REVOKED', 'Agent is already revoked.');

    await prisma.$transaction(async (tx) => {
      await (tx as any).agent.update({
        where: { id: agent.id },
        data: { isActive: false },
      });

      if (agent.apiKeyId) {
        await (tx as any).apiKey.update({
          where: { id: agent.apiKeyId },
          data: { isActive: false, revokedAt: new Date() },
        });
      }
    });

    return { revoked: true };
  }

  // ─── STATUS ───────────────────────────────────────────────
  // Returns agent details scoped to tenant.
  static async status(
    secureContext: SecureContext,
    payload: { agentId: string }
  ) {
    const { tenantId } = secureContext;

    const agent = await prisma.agent.findFirst({
      where: { id: payload.agentId, tenantId },
    });

    if (!agent) throw new AgentError('AGENT_NOT_FOUND', 'Agent not found for this tenant.');

    return agent;
  }
}

export class AgentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AgentError';
  }
}
```

- [ ] **Step 4: Rodar os testes**

```bash
npx vitest run tests/agent-registry.test.ts 2>&1 | tail -10
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add src/services/core-facets/AgentRegistryFacet.ts tests/agent-registry.test.ts
git commit -m "feat(agent): add AgentRegistryFacet with register/revoke/status (TDD)"
```

---

## Task 4: AuthenticatedRequest + requireAgentSignature (TDD)

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/middleware/requireAgentSignature.ts`
- Create: `tests/agent-event.test.ts` (parte 1 — middleware)

- [ ] **Step 1: Estender AuthenticatedRequest**

Em `src/types/index.ts`, adicione `agentId?` na interface `AuthenticatedRequest`:

```typescript
export interface AuthenticatedRequest extends Request {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
    apiKeyPrefix?: string;
    agentId?: string; // set by requireAgentSignature when request comes from a machine identity
}
```

- [ ] **Step 2: Escrever os testes do middleware**

Crie `tests/agent-event.test.ts`:

```typescript
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

import { requireAgentSignature } from '../src/middleware/requireAgentSignature';
import { PostQuantumCrypto } from '../src/utils/PostQuantumCrypto';

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
```

- [ ] **Step 3: Rodar para confirmar que falha**

```bash
npx vitest run tests/agent-event.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../src/middleware/requireAgentSignature'`

- [ ] **Step 4: Implementar o middleware**

Crie `src/middleware/requireAgentSignature.ts`:

```typescript
// ═══════════════════════════════════════════════════════════
// MIDDLEWARE: Agent Signature Verification
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Must run AFTER requireApiKey (depends on req.apiKeyId).
// Validates Falcon-512 payload signature and selector permissions.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { PostQuantumCrypto } from '../utils/PostQuantumCrypto';
import { AuthenticatedRequest } from '../types';

export const requireAgentSignature = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { apiKeyId, body } = req;
  const { selector, assetId, payload, signature } = body ?? {};

  // 1. Find Agent linked to this ApiKey (tenant-scoped)
  const agent = await prisma.agent.findFirst({
    where: { apiKeyId },
  });

  if (!agent) {
    res.status(403).json({ success: false, error: 'This key is not a machine identity.', code: 'NOT_AN_AGENT' });
    return;
  }

  // 2. Check agent is active
  if (!agent.isActive) {
    res.status(403).json({ success: false, error: 'Agent has been revoked.', code: 'AGENT_REVOKED' });
    return;
  }

  // 3. Verify Falcon-512 signature over the canonical body (selector + assetId + payload)
  const signedBody = JSON.stringify({ selector, assetId, payload });
  const isValid = await PostQuantumCrypto.verifySignatureFalcon512(
    signedBody,
    signature,
    agent.publicKeyFalcon
  );

  if (!isValid) {
    res.status(403).json({ success: false, error: 'Payload signature verification failed.', code: 'INVALID_AGENT_SIGNATURE' });
    return;
  }

  // 4. Check selector is in agent's allowlist
  if (!agent.allowedSelectors.includes(selector)) {
    res.status(403).json({ success: false, error: `Selector "${selector}" is not permitted for this agent.`, code: 'SELECTOR_NOT_ALLOWED' });
    return;
  }

  // 5. Inject agentId into request context for downstream handlers
  req.agentId = agent.id;
  next();
};
```

- [ ] **Step 5: Rodar os testes**

```bash
npx vitest run tests/agent-event.test.ts 2>&1 | tail -10
```

Expected: `5 passed`

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/middleware/requireAgentSignature.ts tests/agent-event.test.ts
git commit -m "feat(agent): add requireAgentSignature middleware with Falcon-512 validation (TDD)"
```

---

## Task 5: FacetRegistry + AgentController + agentRoutes + routes/index.ts

**Files:**
- Modify: `src/diamond/FacetRegistry.ts`
- Create: `src/controllers/AgentController.ts`
- Create: `src/routes/v1/agentRoutes.ts`
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Registrar seletores no FacetRegistry**

Em `src/diamond/FacetRegistry.ts`, adicione o import:

```typescript
import { AgentRegistryFacet } from '../services/core-facets/AgentRegistryFacet';
```

Adicione ao final do objeto `FacetRegistry`:

```typescript
    // AGENT REGISTRY (M2M / IoT)
    'agent.register': AgentRegistryFacet.register,
    'agent.revoke': AgentRegistryFacet.revoke,
    'agent.status': AgentRegistryFacet.status,
```

- [ ] **Step 2: Criar AgentController**

Crie `src/controllers/AgentController.ts`:

```typescript
// ═══════════════════════════════════════════════════════════
// CONTROLLER: Agent Event Handler
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Handles POST /api/v1/agent/event.
// requireApiKey + requireAgentSignature run before this.
// Executes the Facet directly via FacetRegistry — no HTTP round-trip.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { FacetRegistry } from '../diamond/FacetRegistry';
import { AuthenticatedRequest } from '../types';

export class AgentController {
  static async handleEvent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { selector, assetId, payload } = req.body;

    if (!Object.prototype.hasOwnProperty.call(FacetRegistry, selector)) {
      res.status(400).json({ success: false, error: 'Unknown selector.', code: 'UNKNOWN_SELECTOR' });
      return;
    }

    const facet = FacetRegistry[selector];

    // secureContext includes agentId so Facets can record machine provenance
    const secureContext = {
      tenantId: req.tenantId!,
      apiKeyId: req.apiKeyId!,
      role: req.apiKeyRole!,
      agentId: req.agentId,
    };

    try {
      const result = await facet(secureContext, { assetId, ...payload });
      res.status(200).json({
        success: true,
        data: result,
        meta: { selector, executionMode: 'AGENT_EVENT', timestamp: new Date().toISOString() },
      });
    } catch (error: any) {
      console.error(`[AgentController] Error executing ${selector}:`, error);
      if (error.code && error.message) {
        res.status(400).json({ success: false, error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ success: false, error: 'Internal Server Error', code: 'E500' });
    }
  }
}
```

- [ ] **Step 3: Criar agentRoutes**

Crie `src/routes/v1/agentRoutes.ts`:

```typescript
// ═══════════════════════════════════════════════════════════
// ROUTE: Agent Event
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// POST /api/v1/agent/event — machine-to-machine event submission.
// Requires ApiKey (linked to Agent) + Falcon-512 payload signature.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireIdempotency } from '../../middleware/idempotencyGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireAgentSignature } from '../../middleware/requireAgentSignature';
import { AgentController } from '../../controllers/AgentController';

const router = Router();

/**
 * @openapi
 * /api/v1/agent/event:
 *   post:
 *     summary: Submit a machine-to-machine event
 *     description: |
 *       Authenticated by an Agent ApiKey + Falcon-512 payload signature.
 *       The selector must be in the Agent's allowedSelectors list.
 *     tags: [Agents]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [selector, assetId, payload, signature]
 *             properties:
 *               selector:
 *                 type: string
 *                 example: event.recordAuthenticated
 *               assetId:
 *                 type: string
 *               payload:
 *                 type: object
 *               signature:
 *                 type: string
 *                 description: Falcon-512 signature of JSON.stringify({selector,assetId,payload}) in base64
 *     responses:
 *       200:
 *         description: Event accepted and queued for anchoring
 *       403:
 *         description: Invalid signature, revoked agent, or unauthorized selector
 */
router.post(
  '/event',
  requireApiKey,
  requireIdempotency,
  tenantRateLimiter,
  requireAgentSignature,
  AgentController.handleEvent,
);

export default router;
```

- [ ] **Step 4: Montar rota em routes/index.ts**

Em `src/routes/index.ts`, adicione o import:

```typescript
import agentRoutes from './v1/agentRoutes';
```

Adicione após o mount de `circuitBreakerRoutes` (antes do bloco do DiamondProxy):

```typescript
// ═══════════════════════════════════════════════════════════
// SUB-SISTEMA 4: M2M / Agent Registry
// ═══════════════════════════════════════════════════════════

// Agent Events — POST /api/v1/agent/event
router.use('/v1/agent', agentRoutes);
```

- [ ] **Step 5: Verificar que compila sem erros**

```bash
npm run build 2>&1 | tail -10
```

Expected: sem erros de tipo.

- [ ] **Step 6: Rodar todos os testes unitários existentes**

```bash
npm test 2>&1 | tail -15
```

Expected: todos os testes existentes continuam passando.

- [ ] **Step 7: Commit**

```bash
git add src/diamond/FacetRegistry.ts src/controllers/AgentController.ts src/routes/v1/agentRoutes.ts src/routes/index.ts
git commit -m "feat(agent): wire AgentController, agentRoutes, FacetRegistry selectors"
```

---

## Task 6: Testes de integração do AgentController

**Files:**
- Modify: `tests/agent-event.test.ts` — adicionar testes do AgentController

- [ ] **Step 1: Adicionar testes do AgentController ao arquivo existente**

Ao final de `tests/agent-event.test.ts`, adicione:

```typescript
// ─────────────────────────────────────────────────────────
// AgentController.handleEvent
// ─────────────────────────────────────────────────────────
import { AgentController } from '../src/controllers/AgentController';

// Mock FacetRegistry
vi.mock('../src/diamond/FacetRegistry', () => ({
  FacetRegistry: {
    'event.recordAuthenticated': vi.fn(),
  },
}));

import { FacetRegistry } from '../src/diamond/FacetRegistry';

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
  });
});
```

- [ ] **Step 2: Rodar todos os testes do arquivo**

```bash
npx vitest run tests/agent-event.test.ts 2>&1 | tail -15
```

Expected: `9 passed` (5 middleware + 4 controller)

- [ ] **Step 3: Rodar a suite completa**

```bash
npm test 2>&1 | tail -15
```

Expected: todos os testes passam.

- [ ] **Step 4: Commit final**

```bash
git add tests/agent-event.test.ts
git commit -m "test(agent): add AgentController integration tests"
```

---

## Task 7: Verificação Final

- [ ] **Step 1: Build de produção limpo**

```bash
npm run build 2>&1 | tail -5
```

Expected: sem erros.

- [ ] **Step 2: Suite de testes completa**

```bash
npm test 2>&1 | tail -20
```

Expected: todos os testes existentes + novos passam. Nenhuma regressão.

- [ ] **Step 3: Commit de fechamento**

```bash
git add -A
git status
```

Confirme que não há arquivos não intencionais antes de commitar:

```bash
git commit -m "feat(agent): Sub-sistema 4 M2M Agent Registry — complete implementation"
```
