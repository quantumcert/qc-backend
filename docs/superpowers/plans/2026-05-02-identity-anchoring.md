# Identity Anchoring on Profile Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um usuário preenche nome + CPF + data de nascimento + email pela primeira vez, sua identidade é registrada como Asset no `qc-backend` e ancorada no Algorand; o `qc-dashboard` exibe um badge "Identidade Certificada" com link para a transação.

**Architecture:** `IdentityFacet` no `qc-backend` lida com registro idempotente e consulta de status via dois seletores Diamond (`identity.register`, `identity.status`). O `qc-dashboard` dispara o registro no `updateProfile` e consulta o status no `checkIdentityStatus`; o `AnchorQueueService` existente cuida do anchoring assíncrono sem nenhuma mudança.

**Tech Stack:** TypeScript · Prisma · Vitest · Drizzle ORM · tRPC · React · Axios (`QCBackendClient`)

---

## Mapa de Arquivos

| Ação | Arquivo |
|---|---|
| **Criar** | `qc-backend/src/services/core-facets/IdentityFacet.ts` |
| **Modificar** | `qc-backend/src/diamond/FacetRegistry.ts` |
| **Criar** | `qc-backend/tests/identity-facet.test.ts` |
| **Modificar** | `qc-dashboard/drizzle/schema.ts` |
| **Modificar** | `qc-dashboard/server/services/qcBackendClient.ts` |
| **Modificar** | `qc-dashboard/server/routers.ts` |
| **Criar** | `qc-dashboard/server/test/auth.identity.test.ts` |
| **Modificar** | `qc-dashboard/client/src/pages/UserProfile.tsx` |

---

## Task 1: IdentityFacet — testes (qc-backend)

**Files:**
- Create: `tests/identity-facet.test.ts`

- [ ] **Step 1: Criar o arquivo de testes com mocks de Prisma**

```typescript
// tests/identity-facet.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/prisma', () => ({
  default: {
    asset: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    eventLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import prisma from '../src/config/prisma';
import { IdentityFacet } from '../src/services/core-facets/IdentityFacet';

const adminCtx  = { tenantId: 'tenant-1', apiKeyId: 'key-1', role: 'ADMIN' };
const operatorCtx = { tenantId: 'tenant-1', apiKeyId: 'key-2', role: 'OPERATOR' };
const readerCtx = { tenantId: 'tenant-1', apiKeyId: 'key-3', role: 'READER' };

const registerPayload = {
  ownerRef: 'user-openid-abc',
  name: 'João Silva',
  cpf: '123.456.789-00',
  dateOfBirth: '1990-05-15',
  email: 'joao@email.com',
};

const mockAsset = {
  id: 'asset-identity-1',
  tenantId: 'tenant-1',
  externalId: 'user-openid-abc',
  metadata: { type: 'identity', name: 'João Silva', cpf: '123.456.789-00', dateOfBirth: '1990-05-15', email: 'joao@email.com' },
  status: 'ACTIVE',
};

const mockEventPending = {
  id: 'evt-1',
  assetId: 'asset-identity-1',
  dltTxId: null,
  payload: { action: 'IDENTITY_REGISTERED' },
};

const mockEventCertified = {
  id: 'evt-1',
  assetId: 'asset-identity-1',
  dltTxId: 'ALGO123ABC',
  createdAt: new Date('2026-05-02T12:00:00Z'),
  payload: { action: 'IDENTITY_REGISTERED' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IdentityFacet.register', () => {
  it('✅ cria Asset + EventLog com dltTxId null', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.asset.create).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue(mockEventPending as any);

    const result = await IdentityFacet.register(adminCtx, registerPayload);

    expect(prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          externalId: 'user-openid-abc',
          metadata: expect.objectContaining({ type: 'identity' }),
        }),
      })
    );
    expect(prisma.eventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assetId: 'asset-identity-1',
          dltTxId: null,
          payload: expect.objectContaining({ action: 'IDENTITY_REGISTERED' }),
        }),
      })
    );
    expect(result).toEqual({ assetId: 'asset-identity-1', status: 'pending' });
  });

  it('✅ idempotente — segunda chamada com mesmo ownerRef retorna asset existente sem duplicar', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(mockAsset as any);

    const result = await IdentityFacet.register(adminCtx, registerPayload);

    expect(prisma.asset.create).not.toHaveBeenCalled();
    expect(prisma.eventLog.create).not.toHaveBeenCalled();
    expect(result).toEqual({ assetId: 'asset-identity-1', status: 'pending' });
  });

  it('🚫 READER não pode registrar — lança INSUFFICIENT_PERMISSIONS', async () => {
    await expect(IdentityFacet.register(readerCtx, registerPayload)).rejects.toMatchObject({
      code: 'INSUFFICIENT_PERMISSIONS',
    });
    expect(prisma.asset.findFirst).not.toHaveBeenCalled();
  });
});

describe('IdentityFacet.getStatus', () => {
  it('✅ retorna "pending" quando dltTxId é null', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.eventLog.findFirst).mockResolvedValue(mockEventPending as any);

    const result = await IdentityFacet.getStatus(readerCtx, { assetId: 'asset-identity-1' });

    expect(result).toEqual({ status: 'pending' });
  });

  it('✅ retorna "certified" + txId quando dltTxId está preenchido', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.eventLog.findFirst).mockResolvedValue(mockEventCertified as any);

    const result = await IdentityFacet.getStatus(readerCtx, { assetId: 'asset-identity-1' });

    expect(result).toEqual({
      status: 'certified',
      txId: 'ALGO123ABC',
      anchoredAt: new Date('2026-05-02T12:00:00Z'),
    });
  });

  it('🚫 assetId desconhecido lança NOT_FOUND', async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

    await expect(IdentityFacet.getStatus(readerCtx, { assetId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar falha**

```bash
cd /Volumes/External\ SSD/Projects/qc-backend
npm test tests/identity-facet.test.ts
```

Saída esperada: `FAIL` — `Cannot find module '../src/services/core-facets/IdentityFacet'`

---

## Task 2: IdentityFacet — implementação (qc-backend)

**Files:**
- Create: `src/services/core-facets/IdentityFacet.ts`

- [ ] **Step 1: Criar o arquivo**

```typescript
// src/services/core-facets/IdentityFacet.ts
import prisma from '../../config/prisma';

interface SecureContext {
  tenantId: string;
  apiKeyId: string;
  role: string;
}

interface RegisterPayload {
  ownerRef: string;
  name: string;
  cpf: string;
  dateOfBirth: string;
  email: string;
}

interface StatusPayload {
  assetId: string;
}

function makeError(message: string, code: string, httpStatus: number): Error {
  const err: any = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  return err;
}

export class IdentityFacet {
  static async register(secureContext: SecureContext, payload: RegisterPayload) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN' && role !== 'OPERATOR') {
      throw makeError('Insufficient permissions', 'INSUFFICIENT_PERMISSIONS', 403);
    }

    const existing = await prisma.asset.findFirst({
      where: { tenantId, externalId: payload.ownerRef },
    });

    if (existing) {
      return { assetId: existing.id, status: 'pending' as const };
    }

    const asset = await prisma.asset.create({
      data: {
        tenantId,
        externalId: payload.ownerRef,
        metadata: {
          type: 'identity',
          name: payload.name,
          cpf: payload.cpf,
          dateOfBirth: payload.dateOfBirth,
          email: payload.email,
        },
      },
    });

    await prisma.eventLog.create({
      data: {
        assetId: asset.id,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        dltTxId: null,
        payload: { action: 'IDENTITY_REGISTERED', ownerRef: payload.ownerRef },
      },
    });

    return { assetId: asset.id, status: 'pending' as const };
  }

  static async getStatus(secureContext: SecureContext, payload: StatusPayload) {
    const { tenantId } = secureContext;

    const asset = await prisma.asset.findFirst({
      where: { id: payload.assetId, tenantId },
    });

    if (!asset) {
      throw makeError('Asset not found', 'NOT_FOUND', 404);
    }

    const event = await prisma.eventLog.findFirst({
      where: {
        assetId: payload.assetId,
        tenantId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!event || !event.dltTxId) {
      return { status: 'pending' as const };
    }

    return {
      status: 'certified' as const,
      txId: event.dltTxId,
      anchoredAt: (event as any).createdAt,
    };
  }
}
```

- [ ] **Step 2: Rodar os testes e verificar que passam**

```bash
npm test tests/identity-facet.test.ts
```

Saída esperada: `6 tests passed`

- [ ] **Step 3: Commit**

```bash
git add src/services/core-facets/IdentityFacet.ts tests/identity-facet.test.ts
git commit -m "feat(identity): add IdentityFacet with register + getStatus (TDD)"
```

---

## Task 3: Registrar seletores no FacetRegistry (qc-backend)

**Files:**
- Modify: `src/diamond/FacetRegistry.ts`

- [ ] **Step 1: Adicionar import e seletores**

No topo do arquivo, após o import de `EscrowFacet`, adicionar:

```typescript
import { IdentityFacet } from '../services/core-facets/IdentityFacet';
```

Dentro do objeto `FacetRegistry`, após a seção `// ESCROW TIME-LOCK`, adicionar:

```typescript
    // IDENTITY ANCHORING
    'identity.register': (ctx: any, payload: any) => IdentityFacet.register(ctx, payload),
    'identity.status':   (ctx: any, payload: any) => IdentityFacet.getStatus(ctx, payload),
```

- [ ] **Step 2: Verificar compilação TypeScript**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Saída esperada: sem erros.

- [ ] **Step 3: Rodar suite completa para regressão**

```bash
npm test
```

Saída esperada: todos os testes passam, incluindo os 6 novos de `identity-facet.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/diamond/FacetRegistry.ts
git commit -m "feat(identity): register identity.register + identity.status selectors in FacetRegistry"
```

---

## Task 4: Schema migration no qc-dashboard

**Files:**
- Modify: `qc-dashboard/drizzle/schema.ts`

- [ ] **Step 1: Adicionar colunas na tabela `users`**

No arquivo `drizzle/schema.ts`, dentro do objeto `users = pgTable(...)`, após a linha `metadata: text("metadata")`, adicionar:

```typescript
  // Identity anchoring (qc-backend asset reference)
  identityAssetId: varchar("identityAssetId", { length: 255 }),
  identityStatus:  varchar("identityStatus",  { length: 20 }).default("none"),
```

- [ ] **Step 2: Atualizar o tipo `_memUpsert` no `db.ts` para incluir os novos campos**

No arquivo `server/db.ts`, na função `_memUpsert`, dentro do objeto `newUser`, após `metadata: (user as any).metadata ?? null,`, adicionar:

```typescript
    identityAssetId: (user as any).identityAssetId ?? null,
    identityStatus:  (user as any).identityStatus  ?? 'none',
```

- [ ] **Step 3: Gerar e aplicar a migration**

```bash
cd /Volumes/External\ SSD/Projects/qc-dashboard
npm run db:generate
npm run db:migrate
```

Saída esperada: migration criada e aplicada sem erros.

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts server/db.ts drizzle/
git commit -m "feat(identity): add identityAssetId + identityStatus columns to users table"
```

---

## Task 5: Adicionar `identity` domain ao QCBackendClient

**Files:**
- Modify: `server/services/qcBackendClient.ts`

- [ ] **Step 1: Adicionar o grupo `identity` ao cliente**

No arquivo `server/services/qcBackendClient.ts`, após o bloco `escrow = { ... };`, adicionar:

```typescript
  identity = {
    register: (payload: {
      ownerRef: string;
      name: string;
      cpf: string;
      dateOfBirth: string;
      email: string;
    }) => this.call<{ assetId: string; status: 'pending' }>('identity.register', payload),

    status: (payload: { assetId: string }) =>
      this.call<
        | { status: 'pending' }
        | { status: 'certified'; txId: string; anchoredAt: string }
      >('identity.status', payload),
  };
```

- [ ] **Step 2: Verificar tipos com TypeScript**

```bash
cd /Volumes/External\ SSD/Projects/qc-dashboard
npx tsc --noEmit 2>&1 | grep -E "error" | head -20
```

Saída esperada: sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add server/services/qcBackendClient.ts
git commit -m "feat(identity): add identity.register + identity.status to QCBackendClient"
```

---

## Task 6: Lógica de identidade no `auth.updateProfile` (backend tests)

**Files:**
- Create: `server/test/auth.identity.test.ts`

- [ ] **Step 1: Criar testes para a lógica de identidade no updateProfile**

```typescript
// server/test/auth.identity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMockQcClient } from './_helpers';

// Silence logger
vi.mock('../_core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), database: vi.fn() }
}));

// Mock db module
vi.mock('../db', async () => {
  const mod = await vi.importActual('../db') as any;
  return { ...mod, updateUser: vi.fn(), getUserById: vi.fn(), upsertUser: vi.fn() };
});

import * as db from '../db';
import { appRouter } from '../routers';
import { makeCallerContext } from './_helpers';

function makeCallerContext(qcClient: any, userId: number) {
  return {
    req: { cookies: {}, headers: {} } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
    user: { id: userId, role: 'user', openId: `openid-${userId}` } as any,
    qcClient,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('auth.updateProfile — identity anchoring', () => {
  it('✅ campos incompletos → não chama identity.register', async () => {
    const qcClient = makeMockQcClient();
    const identityRegister = vi.spyOn(qcClient.identity, 'register');
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 1, identityStatus: 'none', name: null, cpf: null, dateOfBirth: null, email: null,
    } as any);
    vi.mocked(db.updateUser).mockResolvedValue(undefined as any);

    const caller = appRouter.createCaller(makeCallerContext(qcClient, 1));
    await caller.auth.updateProfile({ name: 'João' }); // sem cpf, dob, email

    expect(identityRegister).not.toHaveBeenCalled();
  });

  it('✅ todos os campos preenchidos + identityStatus "none" → registra identidade + salva "pending"', async () => {
    const qcClient = makeMockQcClient();
    vi.spyOn(qcClient.identity, 'register').mockResolvedValue({ assetId: 'asset-id-123', status: 'pending' });
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 1, identityStatus: 'none', openId: 'openid-1',
      name: 'João', cpf: '123.456.789-00', dateOfBirth: '1990-05-15', email: 'joao@email.com',
      metadata: null,
    } as any);
    vi.mocked(db.updateUser).mockResolvedValue(undefined as any);
    vi.mocked(db.upsertUser).mockResolvedValue(undefined as any);

    const caller = appRouter.createCaller(makeCallerContext(qcClient, 1));
    await caller.auth.updateProfile({ name: 'João', cpf: '123.456.789-00', dateOfBirth: '1990-05-15' });

    expect(qcClient.identity.register).toHaveBeenCalledWith(
      expect.objectContaining({ ownerRef: 'openid-1', cpf: '123.456.789-00' })
    );
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ identityAssetId: 'asset-id-123', identityStatus: 'pending' })
    );
  });

  it('✅ identityStatus "pending" → consulta status + atualiza para "certified" se txId disponível', async () => {
    const qcClient = makeMockQcClient();
    vi.spyOn(qcClient.identity, 'status').mockResolvedValue({
      status: 'certified', txId: 'ALGO123', anchoredAt: '2026-05-02T12:00:00Z',
    });
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 1, identityStatus: 'pending', identityAssetId: 'asset-id-123', openId: 'openid-1',
      name: 'João', cpf: '123.456.789-00', dateOfBirth: '1990-05-15', email: 'joao@email.com',
      metadata: null,
    } as any);
    vi.mocked(db.updateUser).mockResolvedValue(undefined as any);
    vi.mocked(db.upsertUser).mockResolvedValue(undefined as any);

    const caller = appRouter.createCaller(makeCallerContext(qcClient, 1));
    await caller.auth.updateProfile({ name: 'João' });

    expect(qcClient.identity.status).toHaveBeenCalledWith({ assetId: 'asset-id-123' });
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ identityStatus: 'certified' })
    );
  });

  it('✅ identity.register lança erro → perfil salvo, identityStatus permanece "none"', async () => {
    const qcClient = makeMockQcClient();
    vi.spyOn(qcClient.identity, 'register').mockRejectedValue(new Error('Backend offline'));
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 1, identityStatus: 'none', openId: 'openid-1',
      name: 'João', cpf: '123.456.789-00', dateOfBirth: '1990-05-15', email: 'joao@email.com',
      metadata: null,
    } as any);
    vi.mocked(db.updateUser).mockResolvedValue(undefined as any);

    const caller = appRouter.createCaller(makeCallerContext(qcClient, 1));
    // Não deve lançar — perfil salva silenciosamente
    await expect(caller.auth.updateProfile({ name: 'João', cpf: '123.456.789-00', dateOfBirth: '1990-05-15' })).resolves.toMatchObject({ success: true });

    // upsertUser de identidade NÃO chamado (erro silenciado)
    expect(db.upsertUser).not.toHaveBeenCalled();
  });

  it('✅ identityStatus "certified" → não chama nada além de updateUser', async () => {
    const qcClient = makeMockQcClient();
    const identityRegister = vi.spyOn(qcClient.identity, 'register');
    const identityStatus = vi.spyOn(qcClient.identity, 'status');
    vi.mocked(db.getUserById).mockResolvedValue({
      id: 1, identityStatus: 'certified', identityAssetId: 'asset-id-123', openId: 'openid-1',
      name: 'João', cpf: '123.456.789-00', dateOfBirth: '1990-05-15', email: 'joao@email.com',
      metadata: null,
    } as any);
    vi.mocked(db.updateUser).mockResolvedValue(undefined as any);

    const caller = appRouter.createCaller(makeCallerContext(qcClient, 1));
    await caller.auth.updateProfile({ name: 'João' });

    expect(identityRegister).not.toHaveBeenCalled();
    expect(identityStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha (lógica ainda não existe)**

```bash
cd /Volumes/External\ SSD/Projects/qc-dashboard
npm test server/test/auth.identity.test.ts
```

Saída esperada: `FAIL` — testes de identityStatus falham pois a lógica não existe em `routers.ts`.

---

## Task 7: Implementar lógica de identidade no `auth.updateProfile`

**Files:**
- Modify: `server/routers.ts`

- [ ] **Step 1: Adicionar import do qcClient no contexto tRPC (verificar se já existe)**

Verificar em `server/_core/trpc.ts` se `qcClient` já é injetado no contexto. Se não, verificar como o contexto é construído. Localizar como `qcClient` é obtido nos outros procedures que fazem chamadas ao backend.

```bash
grep -n "qcClient\|QCBackendClient" /Volumes/External\ SSD/Projects/qc-dashboard/server/_core/*.ts | head -20
```

- [ ] **Step 2: Modificar `auth.updateProfile` para incluir lógica de identidade**

No arquivo `server/routers.ts`, substituir o bloco do `updateProfile` mutation a partir de `await db.updateUser(...)` até o `return { success: true }`:

```typescript
      .mutation(async ({ ctx, input }) => {
        // Handle Metadata (Avatar/Medical)
        const user = await db.getUserById(ctx.user.id);
        let metadata: any = {};
        try { metadata = user?.metadata ? JSON.parse(user.metadata) : {}; } catch (e) { }

        if (input.avatarUrl) metadata.avatarUrl = input.avatarUrl;
        if (input.medicalDocUrl) metadata.medicalDocUrl = input.medicalDocUrl;

        await db.updateUser(ctx.user.id, {
          ...input,
          metadata: JSON.stringify(metadata)
        } as any);

        // --- Identity anchoring ---
        const identityStatus = (user as any)?.identityStatus ?? 'none';
        const identityAssetId = (user as any)?.identityAssetId ?? null;
        const openId = ctx.user.openId;

        // Merge saved fields with input (input may update some fields)
        const name       = input.name       ?? user?.name       ?? null;
        const cpf        = input.cpf        ?? (user as any)?.cpf        ?? null;
        const dateOfBirth = input.dateOfBirth ?? (user as any)?.dateOfBirth ?? null;
        const email      = (user as any)?.email ?? null;

        if (identityStatus === 'none' && name && cpf && dateOfBirth && email) {
          try {
            const result = await ctx.qcClient.identity.register({
              ownerRef: openId,
              name,
              cpf,
              dateOfBirth,
              email,
            });
            await db.upsertUser({
              openId,
              identityAssetId: result.assetId,
              identityStatus: 'pending',
            } as any);
          } catch {
            // silent — profile save succeeded, AnchorQueueService will retry
          }
        } else if (identityStatus === 'pending' && identityAssetId) {
          try {
            const statusResult = await ctx.qcClient.identity.status({ assetId: identityAssetId });
            if (statusResult.status === 'certified') {
              const certifiedResult = statusResult as { status: 'certified'; txId: string; anchoredAt: string };
              const updatedMeta = { ...metadata, identityTxId: certifiedResult.txId };
              await db.upsertUser({
                openId,
                identityStatus: 'certified',
                metadata: JSON.stringify(updatedMeta),
              } as any);
            }
          } catch {
            // silent — will retry on next profile open
          }
        }
        // identityStatus === 'certified' → nothing to do

        return { success: true };
      }),
```

- [ ] **Step 3: Adicionar `auth.checkIdentityStatus` procedure**

Dentro do `auth: router({...})`, após o `updateProfile`, adicionar:

```typescript
    checkIdentityStatus: protectedProcedure
      .mutation(async ({ ctx }) => {
        const user = await db.getUserById(ctx.user.id);
        const identityAssetId = (user as any)?.identityAssetId;
        const identityStatus  = (user as any)?.identityStatus ?? 'none';

        if (identityStatus !== 'pending' || !identityAssetId) {
          return { identityStatus: identityStatus ?? 'none' };
        }

        try {
          const result = await ctx.qcClient.identity.status({ assetId: identityAssetId });
          if (result.status === 'certified') {
            const certifiedResult = result as { status: 'certified'; txId: string; anchoredAt: string };
            let metadata: any = {};
            try { metadata = user?.metadata ? JSON.parse(user.metadata) : {}; } catch (e) { }
            await db.upsertUser({
              openId: ctx.user.openId,
              identityStatus: 'certified',
              metadata: JSON.stringify({ ...metadata, identityTxId: certifiedResult.txId }),
            } as any);
            return { identityStatus: 'certified', txId: certifiedResult.txId };
          }
        } catch {
          // silent
        }

        return { identityStatus: 'pending' };
      }),
```

- [ ] **Step 4: Rodar os testes de identidade**

```bash
npm test server/test/auth.identity.test.ts
```

Saída esperada: `5 tests passed`

- [ ] **Step 5: Rodar suite completa para regressão**

```bash
npm test
```

Saída esperada: sem regressões.

- [ ] **Step 6: Commit**

```bash
git add server/routers.ts server/test/auth.identity.test.ts
git commit -m "feat(identity): add anchoring logic to updateProfile + checkIdentityStatus procedure"
```

---

## Task 8: Badge de identidade no `UserProfile.tsx`

**Files:**
- Modify: `client/src/pages/UserProfile.tsx`

- [ ] **Step 1: Adicionar `useEffect` para polling de status e mutation `checkIdentityStatus`**

No bloco `import` adicionar (se não existir):
```typescript
import { ShieldCheck, Clock } from "lucide-react";
```

Logo após `const updateProfile = trpc.auth.updateProfile.useMutation(...)`, adicionar:

```typescript
  const checkIdentityStatus = trpc.auth.checkIdentityStatus.useMutation({
    onSuccess: (data) => {
      if (data.identityStatus === 'certified') {
        // Força re-fetch do user para exibir badge atualizado
        window.location.reload();
      }
    },
  });

  const identityStatus = (user as any)?.identityStatus ?? 'none';
  const identityTxId: string | undefined = (() => {
    try { return JSON.parse((user as any)?.metadata ?? '{}')?.identityTxId; } catch { return undefined; }
  })();

  useEffect(() => {
    if (identityStatus === 'pending') {
      checkIdentityStatus.mutate();
    }
  }, [identityStatus]);
```

- [ ] **Step 2: Criar componente `IdentityBadge` inline**

Antes do `return (` da função `UserProfile`, adicionar:

```typescript
  const IdentityBadge = () => {
    if (identityStatus === 'certified' && identityTxId) {
      return (
        <div className="flex items-center gap-2 text-sm text-green-500 font-medium">
          <ShieldCheck className="h-4 w-4" />
          <span>Identidade Certificada</span>
          <a
            href={`https://algoexplorer.io/tx/${identityTxId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-xs text-green-400 hover:text-green-300"
          >
            Ver na blockchain
          </a>
        </div>
      );
    }
    if (identityStatus === 'pending') {
      return (
        <div className="flex items-center gap-2 text-sm text-yellow-500 font-medium">
          <Clock className="h-4 w-4 animate-spin" />
          <span>Certificação pendente...</span>
        </div>
      );
    }
    return (
      <p className="text-xs text-muted-foreground">
        Preencha nome, CPF e data de nascimento para certificar sua identidade
      </p>
    );
  };
```

- [ ] **Step 3: Inserir o badge na UI**

Dentro do JSX do componente, localizar o `<CardHeader>` do card de "Informações Pessoais" e adicionar `<IdentityBadge />` após a `<CardDescription>`:

```tsx
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Informações Pessoais</CardTitle>
              <CardDescription>Dados visíveis na sua QTAG LIFE</CardDescription>
              <div className="mt-2">
                <IdentityBadge />
              </div>
            </div>
            {/* botão de editar permanece igual */}
```

- [ ] **Step 4: Verificar tipos TypeScript do frontend**

```bash
cd /Volumes/External\ SSD/Projects/qc-dashboard
npx tsc --noEmit 2>&1 | grep error | head -20
```

Saída esperada: sem erros.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/UserProfile.tsx
git commit -m "feat(identity): add IdentityBadge + polling hook to UserProfile"
```

---

## Task 9: Adicionar `identity` ao `makeMockQcClient` (helpers de teste)

**Files:**
- Modify: `server/test/_helpers.ts`

- [ ] **Step 1: Adicionar domain `identity` ao mock**

No arquivo `server/test/_helpers.ts`, dentro do objeto retornado por `makeMockQcClient()`, após o bloco `escrow:`, adicionar:

```typescript
    identity: {
      register: async (_p: any) => ({ assetId: `mock-identity-asset-${nanoid()}`, status: 'pending' as const }),
      status: async (_p: any) => ({ status: 'pending' as const }),
    },
```

- [ ] **Step 2: Confirmar que o TypeScript aceita sem erros**

```bash
npx tsc --noEmit 2>&1 | grep error | head -20
```

- [ ] **Step 3: Rodar suite completa final**

```bash
npm test
```

Saída esperada: todos os testes passam.

- [ ] **Step 4: Commit final**

```bash
git add server/test/_helpers.ts
git commit -m "test(identity): add identity mock to makeMockQcClient helper"
```

---

## Self-Review

### Cobertura da spec

| Requisito | Task |
|---|---|
| `IdentityFacet.register` com idempotência | Task 1 + 2 |
| `IdentityFacet.getStatus` com pending/certified | Task 1 + 2 |
| RBAC: register requer OPERATOR/ADMIN | Task 1 + 2 |
| Seletores `identity.register` + `identity.status` no FacetRegistry | Task 3 |
| Colunas `identityAssetId` + `identityStatus` no schema | Task 4 |
| `QCBackendClient.identity` domain | Task 5 |
| `updateProfile` dispara `identity.register` quando campos completos | Task 6 + 7 |
| `updateProfile` faz poll de status quando `pending` | Task 6 + 7 |
| Falha silenciosa — perfil salva mesmo com anchoring falhando | Task 6 + 7 |
| `auth.checkIdentityStatus` procedure | Task 7 |
| Badge `none` / `pending` / `certified` | Task 8 |
| Link para Algorand Explorer no badge certified | Task 8 |
| `makeMockQcClient` inclui domain identity | Task 9 |

### Itens fora do escopo (conforme spec)

- Re-anchoring quando dados mudam após certificação → `identity.update` (futuro)
- Multi-chain → apenas Algorand via `AnchorQueueService` existente
- Admin UI para identidades certificadas
- Email de notificação

### Consistência de tipos

- `IdentityFacet.register` retorna `{ assetId: string; status: 'pending' }` — bate com `QCBackendClient.identity.register`
- `IdentityFacet.getStatus` retorna union `{ status: 'pending' } | { status: 'certified'; txId: string; anchoredAt: Date }` — bate com o type cast em `routers.ts`
- `identityStatus` no schema Drizzle: `'none' | 'pending' | 'certified'` — bate com os guards em `routers.ts` e `UserProfile.tsx`
