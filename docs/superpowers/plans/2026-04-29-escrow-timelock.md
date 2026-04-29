# EscrowFacet + Time-Lock Oracle + Diamond Gateway Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar EscrowFacet com Time-Lock Oracle (AUTO/MANUAL por escrow), EscrowReleaseWorker cron e migrar lifecycle/transfer do REST dedicado para o Diamond como único gateway de operações mutantes.

**Architecture:** EscrowFacet segue o padrão `(secureContext, payload)` de todas as facetas — puro, sem dependências Express. EscrowReleaseWorker segue o padrão overlap-lock do AnchorQueueService. Todas as rotas REST dedicadas de domínio são removidas; Diamond é o único gateway.

**Tech Stack:** Node.js, TypeScript, Prisma/PostgreSQL, Vitest, node-cron, DLTAdapterFactory (multi-chain já implementado)

---

## Mapa de Arquivos

| Arquivo | Ação |
|---|---|
| `prisma/schema.prisma` | Modificar — `releaseMode`, `releaseConfirmedAt` no Escrow; `PROCESSING` no EscrowStatus |
| `src/services/core-facets/EscrowFacet.ts` | Criar |
| `src/services/EscrowReleaseWorker.ts` | Criar |
| `src/diamond/FacetRegistry.ts` | Modificar — 4 seletores escrow |
| `src/services/SchedulerService.ts` | Modificar — cron EscrowReleaseWorker |
| `src/routes/index.ts` | Modificar — remover mounts de lifecycle e transfer |
| `src/routes/v1/lifecycleRoutes.ts` | Remover |
| `src/controllers/LifecycleController.ts` | Remover |
| `src/routes/v1/transferRoutes.ts` | Remover |
| `src/controllers/TransferController.ts` | Remover |
| `.env.example` | Modificar — adicionar `ESCROW_RELEASE_INTERVAL_SECONDS` |
| `tests/escrow-facet.test.ts` | Criar |
| `tests/escrow-release-worker.test.ts` | Criar |
| `tests/escrow-diamond.test.ts` | Criar |
| `tests/lifecycle-diamond.test.ts` | Criar |
| `tests/transfer-diamond.test.ts` | Criar |

---

## Task 1: Schema — Adicionar campos ao Escrow + PROCESSING ao EscrowStatus

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar `PROCESSING` ao enum `EscrowStatus` e campos ao model `Escrow`**

Localize o enum `EscrowStatus` e o model `Escrow` no schema. Adicione:

```prisma
enum EscrowStatus {
  PENDING
  ACTIVE
  PROCESSING  // ← adicionar: lock atômico usado pelo EscrowReleaseWorker
  RELEASED
  CANCELLED
  EXPIRED
}
```

No model `Escrow`, após o campo `metadata`:

```prisma
  releaseMode        String    @default("AUTO")  // 'AUTO' | 'MANUAL'
  releaseConfirmedAt DateTime?                   // audit timestamp for manual releases
```

- [ ] **Step 2: Gerar e aplicar migration**

```bash
npm run db:migrate
```

Quando solicitado o nome da migration, digite: `add_release_mode_to_escrow`

Saída esperada: `Your database is now in sync with your schema.`

- [ ] **Step 3: Regenerar Prisma client**

```bash
npm run db:generate
```

Saída esperada: `Generated Prisma Client` sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(escrow): add releaseMode, releaseConfirmedAt fields and PROCESSING status to Escrow schema"
```

---

## Task 2: EscrowFacet — Testes (TDD)

**Files:**
- Create: `tests/escrow-facet.test.ts`

- [ ] **Step 1: Criar arquivo de testes**

```typescript
// tests/escrow-facet.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('../src/config/prisma', () => ({
  default: {
    asset: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    escrow: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    eventLog: {
      create: vi.fn(),
    },
  },
}));

// Mock DLTAdapterFactory
vi.mock('../src/services/DLTAdapterFactory', () => ({
  DLTAdapterFactory: {
    getAdapter: vi.fn(() => ({
      createEscrow: vi.fn().mockResolvedValue('mock-chain-tx-id'),
      releaseEscrow: vi.fn().mockResolvedValue('mock-release-tx-id'),
      cancelEscrow: vi.fn().mockResolvedValue('mock-cancel-tx-id'),
    })),
  },
}));

import prisma from '../src/config/prisma';
import { DLTAdapterFactory } from '../src/services/DLTAdapterFactory';
import { EscrowFacet } from '../src/services/core-facets/EscrowFacet';

const adminCtx = { tenantId: 'tenant-1', apiKeyId: 'key-1', role: 'ADMIN' };
const operatorCtx = { tenantId: 'tenant-1', apiKeyId: 'key-2', role: 'OPERATOR' };
const readerCtx = { tenantId: 'tenant-1', apiKeyId: 'key-3', role: 'READER' };

const mockAsset = { id: 'asset-1', tenantId: 'tenant-1', status: 'ACTIVE' };
const mockEscrowActive = {
  id: 'esc-db-1',
  escrowId: 'escrow-1',
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  chain: 'SOLANA',
  chainTxId: 'mock-chain-tx-id',
  status: 'ACTIVE',
  releaseMode: 'AUTO',
  sender: 'sender-wallet',
  receiver: 'receiver-wallet',
  amount: '1000000',
  unlockTimestamp: new Date(Date.now() + 86400000), // tomorrow
  releaseConfirmedAt: null,
};

const lockPayload = {
  assetId: 'asset-1',
  escrowId: 'escrow-1',
  chain: 'SOLANA' as const,
  sender: 'sender-wallet',
  receiver: 'receiver-wallet',
  amount: '1000000',
  unlockTimestamp: Math.floor(Date.now() / 1000) + 86400, // tomorrow in Unix seconds
  releaseMode: 'AUTO' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EscrowFacet.lock', () => {
  it('✅ locks asset and creates escrow record', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.escrow.create).mockResolvedValue({ ...mockEscrowActive, chainTxId: null } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({ ...mockAsset, status: 'LOCKED_IN_ESCROW' } as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.lock(adminCtx, lockPayload);

    expect(result.escrowId).toBe('escrow-1');
    expect(result.assetId).toBe('asset-1');
    expect(result.chainTxId).toBe('mock-chain-tx-id');
    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'LOCKED_IN_ESCROW' } })
    );
    expect(prisma.eventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ action: 'ESCROW_LOCKED' }) }) })
    );
  });

  it('✅ OPERATOR pode fazer lock', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);
    vi.mocked(prisma.escrow.create).mockResolvedValue({ ...mockEscrowActive, chainTxId: null } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    await expect(EscrowFacet.lock(operatorCtx, lockPayload)).resolves.toBeDefined();
  });

  it('🚫 rejeita se asset não está ACTIVE', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({ ...mockAsset, status: 'SUSPENDED' } as any);

    await expect(EscrowFacet.lock(adminCtx, lockPayload)).rejects.toMatchObject({
      code: 'INVALID_ASSET_STATE',
    });
  });

  it('🚫 rejeita se asset não encontrado', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

    await expect(EscrowFacet.lock(adminCtx, lockPayload)).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
    });
  });

  it('🚫 rejeita unlockTimestamp no passado', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);

    await expect(
      EscrowFacet.lock(adminCtx, { ...lockPayload, unlockTimestamp: Math.floor(Date.now() / 1000) - 100 })
    ).rejects.toMatchObject({ code: 'INVALID_UNLOCK_TIMESTAMP' });
  });

  it('🚫 READER não pode fazer lock', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAsset as any);

    await expect(EscrowFacet.lock(readerCtx, lockPayload)).rejects.toMatchObject({
      code: 'INSUFFICIENT_ROLE',
    });
  });
});

describe('EscrowFacet.release', () => {
  it('✅ release MANUAL por OPERATOR', async () => {
    const manualEscrow = { ...mockEscrowActive, releaseMode: 'MANUAL' };
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(manualEscrow as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...manualEscrow, status: 'RELEASED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.release(operatorCtx, { escrowId: 'escrow-1', assetId: 'asset-1' });

    expect(result.status).toBe('RELEASED');
    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ releaseConfirmedAt: expect.any(Date) }) })
    );
  });

  it('✅ release AUTO pelo worker (secureContext sintético)', async () => {
    const workerCtx = { tenantId: 'tenant-1', apiKeyId: 'ESCROW_WORKER', role: 'ADMIN' };
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.release(workerCtx, { escrowId: 'escrow-1', assetId: 'asset-1' });
    expect(result.status).toBe('RELEASED');
  });

  it('🚫 rejeita release REST em escrow AUTO', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, releaseMode: 'AUTO' } as any);

    await expect(
      EscrowFacet.release(operatorCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'RELEASE_MODE_MISMATCH' });
  });

  it('🚫 rejeita se escrow não encontrado', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(null);

    await expect(
      EscrowFacet.release(adminCtx, { escrowId: 'no-escrow', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_NOT_FOUND' });
  });

  it('🚫 rejeita se escrow já RELEASED', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);

    await expect(
      EscrowFacet.release(adminCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_ALREADY_CLOSED' });
  });
});

describe('EscrowFacet.cancel', () => {
  it('✅ ADMIN pode cancelar escrow ACTIVE', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'CANCELLED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const result = await EscrowFacet.cancel(adminCtx, { escrowId: 'escrow-1', assetId: 'asset-1' });
    expect(result.status).toBe('CANCELLED');
  });

  it('🚫 OPERATOR não pode cancelar', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);

    await expect(
      EscrowFacet.cancel(operatorCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('🚫 rejeita cancelar escrow já RELEASED', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);

    await expect(
      EscrowFacet.cancel(adminCtx, { escrowId: 'escrow-1', assetId: 'asset-1' })
    ).rejects.toMatchObject({ code: 'ESCROW_ALREADY_CLOSED' });
  });
});

describe('EscrowFacet.getStatus', () => {
  it('✅ READER pode consultar status', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);

    const result = await EscrowFacet.getStatus(readerCtx, { escrowId: 'escrow-1' });
    expect(result.escrowId).toBe('escrow-1');
    expect(result.status).toBe('ACTIVE');
    expect(result.releaseMode).toBe('AUTO');
  });

  it('🚫 rejeita se escrow não encontrado', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(null);

    await expect(
      EscrowFacet.getStatus(adminCtx, { escrowId: 'no-escrow' })
    ).rejects.toMatchObject({ code: 'ESCROW_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Rodar testes — confirmar falha**

```bash
npm test -- --run tests/escrow-facet.test.ts
```

Saída esperada: `FAIL` com `Cannot find module '../src/services/core-facets/EscrowFacet'`

---

## Task 3: EscrowFacet — Implementação

**Files:**
- Create: `src/services/core-facets/EscrowFacet.ts`

- [ ] **Step 1: Criar EscrowFacet**

```typescript
// src/services/core-facets/EscrowFacet.ts
import prisma from '../../config/prisma';
import { DLTAdapterFactory, SupportedChain } from '../DLTAdapterFactory';
import { TripleSignPayload } from '../multi-chain/types';

interface SecureContext {
  tenantId: string;
  apiKeyId: string;
  role: string;
}

interface LockPayload {
  assetId: string;
  escrowId: string;
  chain: SupportedChain;
  sender: string;
  receiver: string;
  amount: string;
  unlockTimestamp: number;
  releaseMode: 'AUTO' | 'MANUAL';
  assetAddress?: string;
  pqcProof?: string;
  tripleSign?: TripleSignPayload;
}

interface ReleasePayload {
  escrowId: string;
  assetId: string;
}

interface CancelPayload {
  escrowId: string;
  assetId: string;
}

interface StatusPayload {
  escrowId: string;
}

function makeError(message: string, code: string, httpStatus: number): Error {
  const err: any = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  return err;
}

const WORKER_API_KEY_ID = 'ESCROW_WORKER';

export class EscrowFacet {
  static async lock(secureContext: SecureContext, payload: LockPayload) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN' && role !== 'OPERATOR') {
      throw makeError('Insufficient role to lock escrow', 'INSUFFICIENT_ROLE', 403);
    }

    if (payload.unlockTimestamp <= Math.floor(Date.now() / 1000)) {
      throw makeError('unlockTimestamp must be in the future', 'INVALID_UNLOCK_TIMESTAMP', 422);
    }

    const asset = await prisma.asset.findUnique({
      where: { id: payload.assetId, tenantId },
    });

    if (!asset) {
      throw makeError('Asset not found or access denied', 'ASSET_NOT_FOUND', 404);
    }

    if (asset.status !== 'ACTIVE') {
      throw makeError(
        `Asset cannot be locked from state: ${asset.status}`,
        'INVALID_ASSET_STATE',
        422
      );
    }

    const escrow = await prisma.escrow.create({
      data: {
        escrowId: payload.escrowId,
        tenantId,
        assetId: payload.assetId,
        chain: payload.chain,
        sender: payload.sender,
        receiver: payload.receiver,
        amount: payload.amount,
        assetAddress: payload.assetAddress ?? null,
        unlockTimestamp: new Date(payload.unlockTimestamp * 1000),
        releaseMode: payload.releaseMode,
        status: 'ACTIVE',
      },
    });

    const adapter = DLTAdapterFactory.getAdapter(payload.chain);
    const chainTxId = await adapter.createEscrow({
      escrowId: payload.escrowId,
      sender: payload.sender,
      receiver: payload.receiver,
      amount: payload.amount,
      assetAddress: payload.assetAddress,
      unlockTimestamp: payload.unlockTimestamp,
      pqcProof: payload.pqcProof,
      tripleSign: payload.tripleSign,
    });

    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { chainTxId },
    });

    await prisma.asset.update({
      where: { id: payload.assetId },
      data: { status: 'LOCKED_IN_ESCROW' as any },
    });

    await prisma.eventLog.create({
      data: {
        assetId: payload.assetId,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_LOCKED',
          escrowId: payload.escrowId,
          chain: payload.chain,
          unlockTimestamp: payload.unlockTimestamp,
          releaseMode: payload.releaseMode,
        },
      },
    });

    return { escrowId: payload.escrowId, assetId: payload.assetId, status: 'ACTIVE', chainTxId };
  }

  static async release(secureContext: SecureContext, payload: ReleasePayload) {
    const { tenantId, apiKeyId, role } = secureContext;
    const isWorker = apiKeyId === WORKER_API_KEY_ID;

    const escrow = await prisma.escrow.findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow not found', 'ESCROW_NOT_FOUND', 404);
    }

    if (escrow.status === 'RELEASED' || escrow.status === 'CANCELLED') {
      throw makeError('Escrow is already closed', 'ESCROW_ALREADY_CLOSED', 409);
    }

    if (!isWorker && escrow.releaseMode === 'AUTO') {
      throw makeError(
        'This escrow uses AUTO release mode. Use the EscrowReleaseWorker.',
        'RELEASE_MODE_MISMATCH',
        422
      );
    }

    if (!isWorker && role !== 'ADMIN' && role !== 'OPERATOR') {
      throw makeError('Insufficient role to release escrow', 'INSUFFICIENT_ROLE', 403);
    }

    const adapter = DLTAdapterFactory.getAdapter(escrow.chain as SupportedChain);
    const chainTxId = await adapter.releaseEscrow(escrow.escrowId, escrow.id);

    const updateData: any = { status: 'RELEASED', chainTxId };
    if (!isWorker) {
      updateData.releaseConfirmedAt = new Date();
    }

    await prisma.escrow.update({
      where: { id: escrow.id },
      data: updateData,
    });

    await prisma.asset.update({
      where: { id: payload.assetId },
      data: { status: 'ACTIVE' as any },
    });

    await prisma.eventLog.create({
      data: {
        assetId: payload.assetId,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_RELEASED',
          escrowId: escrow.escrowId,
          releaseMode: escrow.releaseMode,
          releasedBy: isWorker ? 'ESCROW_WORKER' : apiKeyId,
        },
      },
    });

    return { escrowId: escrow.escrowId, assetId: payload.assetId, status: 'RELEASED', chainTxId };
  }

  static async cancel(secureContext: SecureContext, payload: CancelPayload) {
    const { tenantId, apiKeyId, role } = secureContext;

    if (role !== 'ADMIN') {
      throw makeError('Only ADMIN can cancel an escrow', 'INSUFFICIENT_ROLE', 403);
    }

    const escrow = await prisma.escrow.findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow not found', 'ESCROW_NOT_FOUND', 404);
    }

    if (escrow.status === 'RELEASED' || escrow.status === 'CANCELLED') {
      throw makeError('Escrow is already closed', 'ESCROW_ALREADY_CLOSED', 409);
    }

    const adapter = DLTAdapterFactory.getAdapter(escrow.chain as SupportedChain);
    const chainTxId = await adapter.cancelEscrow(escrow.escrowId, escrow.id);

    await prisma.escrow.update({
      where: { id: escrow.id },
      data: { status: 'CANCELLED', chainTxId },
    });

    await prisma.asset.update({
      where: { id: payload.assetId },
      data: { status: 'ACTIVE' as any },
    });

    await prisma.eventLog.create({
      data: {
        assetId: payload.assetId,
        tenantId,
        origin: apiKeyId,
        status: 'APPROVED',
        payload: {
          action: 'ESCROW_CANCELLED',
          escrowId: escrow.escrowId,
          cancelledBy: apiKeyId,
        },
      },
    });

    return { escrowId: escrow.escrowId, assetId: payload.assetId, status: 'CANCELLED', chainTxId };
  }

  static async getStatus(secureContext: SecureContext, payload: StatusPayload) {
    const { tenantId } = secureContext;

    const escrow = await prisma.escrow.findFirst({
      where: { escrowId: payload.escrowId, tenantId },
    });

    if (!escrow) {
      throw makeError('Escrow not found', 'ESCROW_NOT_FOUND', 404);
    }

    return {
      escrowId: escrow.escrowId,
      assetId: escrow.assetId,
      status: escrow.status,
      chain: escrow.chain,
      releaseMode: escrow.releaseMode,
      unlockTimestamp: escrow.unlockTimestamp,
      chainTxId: escrow.chainTxId,
      createdAt: escrow.createdAt,
      releaseConfirmedAt: (escrow as any).releaseConfirmedAt ?? null,
    };
  }
}
```

- [ ] **Step 2: Rodar testes — confirmar aprovação**

```bash
npm test -- --run tests/escrow-facet.test.ts
```

Saída esperada: todos os testes `✅ PASS`

- [ ] **Step 3: Commit**

```bash
git add src/services/core-facets/EscrowFacet.ts tests/escrow-facet.test.ts
git commit -m "feat(escrow): add EscrowFacet with lock/release/cancel/getStatus (TDD)"
```

---

## Task 4: EscrowReleaseWorker — Testes (TDD)

**Files:**
- Create: `tests/escrow-release-worker.test.ts`

- [ ] **Step 1: Criar arquivo de testes**

```typescript
// tests/escrow-release-worker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/prisma', () => ({
  default: {
    escrow: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/services/core-facets/EscrowFacet', () => ({
  EscrowFacet: {
    release: vi.fn(),
  },
}));

import prisma from '../src/config/prisma';
import { EscrowFacet } from '../src/services/core-facets/EscrowFacet';
import { EscrowReleaseWorker } from '../src/services/EscrowReleaseWorker';

const now = new Date();

const makeEscrow = (overrides = {}) => ({
  id: 'esc-db-1',
  escrowId: 'escrow-1',
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  chain: 'SOLANA',
  releaseMode: 'AUTO',
  status: 'ACTIVE',
  unlockTimestamp: new Date(now.getTime() - 1000), // expired
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EscrowReleaseWorker.processReleases', () => {
  it('✅ processa batch de escrows expirados AUTO', async () => {
    const escrows = [makeEscrow(), makeEscrow({ id: 'esc-db-2', escrowId: 'escrow-2' })];
    vi.mocked(prisma.escrow.findMany).mockResolvedValue(escrows as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({} as any);
    vi.mocked(EscrowFacet.release).mockResolvedValue({ status: 'RELEASED' } as any);

    const result = await EscrowReleaseWorker.processReleases();

    expect(result.released).toBe(2);
    expect(result.failed).toBe(0);
    expect(EscrowFacet.release).toHaveBeenCalledTimes(2);
  });

  it('✅ retorna { released: 0, failed: 0 } quando não há escrows expirados', async () => {
    vi.mocked(prisma.escrow.findMany).mockResolvedValue([]);

    const result = await EscrowReleaseWorker.processReleases();

    expect(result.released).toBe(0);
    expect(result.failed).toBe(0);
    expect(EscrowFacet.release).not.toHaveBeenCalled();
  });

  it('✅ ignora escrows com releaseMode MANUAL', async () => {
    vi.mocked(prisma.escrow.findMany).mockResolvedValue([]);

    await EscrowReleaseWorker.processReleases();

    // findMany deve filtrar releaseMode = 'AUTO' — verificar query
    expect(prisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ releaseMode: 'AUTO' }),
      })
    );
  });

  it('🛡️ isola falha: escrow com erro DLT não bloqueia os demais', async () => {
    const escrows = [
      makeEscrow({ escrowId: 'escrow-fail' }),
      makeEscrow({ id: 'esc-db-2', escrowId: 'escrow-ok' }),
    ];
    vi.mocked(prisma.escrow.findMany).mockResolvedValue(escrows as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({} as any);
    vi.mocked(EscrowFacet.release)
      .mockRejectedValueOnce(new Error('DLT_ANCHOR_FAILED'))
      .mockResolvedValueOnce({ status: 'RELEASED' } as any);

    const result = await EscrowReleaseWorker.processReleases();

    expect(result.released).toBe(1);
    expect(result.failed).toBe(1);
    // Escrow com falha deve ter status revertido para ACTIVE
    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } })
    );
  });

  it('🛡️ marca escrow como PROCESSING antes de processar (overlap lock)', async () => {
    const escrow = makeEscrow();
    vi.mocked(prisma.escrow.findMany).mockResolvedValue([escrow] as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({} as any);
    vi.mocked(EscrowFacet.release).mockResolvedValue({ status: 'RELEASED' } as any);

    await EscrowReleaseWorker.processReleases();

    // Primeiro update: marcar como PROCESSING
    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PROCESSING' } })
    );
  });
});
```

- [ ] **Step 2: Rodar testes — confirmar falha**

```bash
npm test -- --run tests/escrow-release-worker.test.ts
```

Saída esperada: `FAIL` com `Cannot find module '../src/services/EscrowReleaseWorker'`

---

## Task 5: EscrowReleaseWorker — Implementação

**Files:**
- Create: `src/services/EscrowReleaseWorker.ts`

- [ ] **Step 1: Criar EscrowReleaseWorker**

```typescript
// src/services/EscrowReleaseWorker.ts
import prisma from '../config/prisma';
import { EscrowFacet } from './core-facets/EscrowFacet';

const WORKER_API_KEY_ID = 'ESCROW_WORKER';
const BATCH_SIZE = 10;

export class EscrowReleaseWorker {
  static async processReleases(): Promise<{ released: number; failed: number }> {
    const now = new Date();

    const expiredEscrows = await prisma.escrow.findMany({
      where: {
        status: 'ACTIVE',
        releaseMode: 'AUTO',
        unlockTimestamp: { lte: now },
      },
      orderBy: { unlockTimestamp: 'asc' },
      take: BATCH_SIZE,
    });

    if (expiredEscrows.length === 0) {
      return { released: 0, failed: 0 };
    }

    let released = 0;
    let failed = 0;

    for (const escrow of expiredEscrows) {
      // Atomic lock: mark as PROCESSING to prevent double-release
      await prisma.escrow.update({
        where: { id: escrow.id },
        data: { status: 'PROCESSING' as any },
      });

      try {
        const workerCtx = {
          tenantId: escrow.tenantId,
          apiKeyId: WORKER_API_KEY_ID,
          role: 'ADMIN',
        };

        await EscrowFacet.release(workerCtx, {
          escrowId: escrow.escrowId,
          assetId: escrow.assetId ?? '',
        });

        released++;
      } catch (err) {
        console.error(`[EscrowReleaseWorker] Failed to release escrow ${escrow.escrowId}:`, err);

        // Revert to ACTIVE so it can be retried next cycle
        await prisma.escrow.update({
          where: { id: escrow.id },
          data: { status: 'ACTIVE' as any },
        });

        failed++;
      }
    }

    return { released, failed };
  }
}
```

- [ ] **Step 2: Rodar testes — confirmar aprovação**

```bash
npm test -- --run tests/escrow-release-worker.test.ts
```

Saída esperada: todos os testes `✅ PASS`

- [ ] **Step 3: Commit**

```bash
git add src/services/EscrowReleaseWorker.ts tests/escrow-release-worker.test.ts
git commit -m "feat(escrow): add EscrowReleaseWorker with batch processing and overlap-lock (TDD)"
```

---

## Task 6: FacetRegistry + SchedulerService

**Files:**
- Modify: `src/diamond/FacetRegistry.ts`
- Modify: `src/services/SchedulerService.ts`
- Modify: `.env.example`

- [ ] **Step 1: Adicionar seletores escrow ao FacetRegistry**

Em `src/diamond/FacetRegistry.ts`, adicione o import e os seletores:

```typescript
// Adicionar import (junto aos demais imports de Facets):
import { EscrowFacet } from '../services/core-facets/EscrowFacet';
```

No objeto `FacetRegistry`, adicione após os seletores de agent:

```typescript
    // ESCROW TIME-LOCK
    'escrow.lock':    (ctx: any, payload: any) => EscrowFacet.lock(ctx, payload),
    'escrow.release': (ctx: any, payload: any) => EscrowFacet.release(ctx, payload),
    'escrow.cancel':  (ctx: any, payload: any) => EscrowFacet.cancel(ctx, payload),
    'escrow.status':  (ctx: any, payload: any) => EscrowFacet.getStatus(ctx, payload),
```

- [ ] **Step 2: Adicionar EscrowReleaseWorker cron ao SchedulerService**

Em `src/services/SchedulerService.ts`, adicione o import no topo:

```typescript
import { EscrowReleaseWorker } from './EscrowReleaseWorker';
```

Ao final do método `SchedulerService.start()`, antes do fechamento da chave, adicione:

```typescript
        // ─── Escrow Release Worker Cron ─────────────────────
        // Runs every 60 seconds to auto-release expired escrows
        let escrowRunning = false;
        const escrowInterval = parseInt(process.env.ESCROW_RELEASE_INTERVAL_SECONDS ?? '60', 10);
        const escrowPattern = `*/${escrowInterval} * * * * *`;

        cron.schedule(escrowPattern, async () => {
            if (escrowRunning) {
                console.log('[Scheduler] EscrowRelease already running, skipping this cycle.');
                return;
            }
            escrowRunning = true;
            try {
                const result = await EscrowReleaseWorker.processReleases();
                if (result.released > 0 || result.failed > 0) {
                    console.log(
                        `[Scheduler] EscrowRelease: ${result.released} released, ${result.failed} failed.`
                    );
                }
            } catch (err) {
                console.error('[Scheduler] EscrowRelease error:', err);
            } finally {
                escrowRunning = false;
            }
        });

        console.log(`[Scheduler] EscrowRelease cron started — interval: ${escrowInterval}s (pattern: ${escrowPattern})`);
```

- [ ] **Step 3: Adicionar env var ao .env.example**

No `.env.example`, adicione na seção de scheduler (após `ANCHOR_QUEUE_INTERVAL_SECONDS`):

```bash
# Escrow Release Worker interval in seconds (default: 60)
ESCROW_RELEASE_INTERVAL_SECONDS=60
```

- [ ] **Step 4: Rodar todos os testes**

```bash
npm test -- --run
```

Saída esperada: todos os testes passando (sem regressões).

- [ ] **Step 5: Commit**

```bash
git add src/diamond/FacetRegistry.ts src/services/SchedulerService.ts .env.example
git commit -m "feat(escrow): register escrow selectors in FacetRegistry and add EscrowRelease cron to SchedulerService"
```

---

## Task 7: Testes de integração Diamond — Escrow

**Files:**
- Create: `tests/escrow-diamond.test.ts`

- [ ] **Step 1: Criar testes de integração via DiamondProxy**

```typescript
// tests/escrow-diamond.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

vi.mock('../src/config/prisma', () => ({
  default: {
    apiKey: { findFirst: vi.fn() },
    rateLimiterLog: { findFirst: vi.fn(), upsert: vi.fn() },
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn() },
    asset: { findUnique: vi.fn(), update: vi.fn() },
    escrow: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    eventLog: { create: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock('../src/services/DLTAdapterFactory', () => ({
  DLTAdapterFactory: {
    getAdapter: vi.fn(() => ({
      createEscrow: vi.fn().mockResolvedValue('mock-chain-tx'),
      releaseEscrow: vi.fn().mockResolvedValue('mock-release-tx'),
      cancelEscrow: vi.fn().mockResolvedValue('mock-cancel-tx'),
    })),
  },
}));

import prisma from '../src/config/prisma';

const mockApiKey = {
  id: 'key-1',
  keyHash: '$2b$10$placeholder',
  tenantId: 'tenant-1',
  role: 'ADMIN',
  isActive: true,
  tenant: { id: 'tenant-1', isActive: true, plan: 'PRO', targetChain: 'SOLANA' },
};

const mockAssetActive = { id: 'asset-1', tenantId: 'tenant-1', status: 'ACTIVE' };
const mockEscrowActive = {
  id: 'esc-db-1', escrowId: 'esc-uuid-1', assetId: 'asset-1',
  tenantId: 'tenant-1', chain: 'SOLANA', status: 'ACTIVE',
  releaseMode: 'MANUAL', chainTxId: 'mock-chain-tx',
  unlockTimestamp: new Date(Date.now() + 86400000),
  releaseConfirmedAt: null,
};

function setupApiKeyMock() {
  vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(mockApiKey as any);
  vi.mocked(prisma.rateLimiterLog.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.rateLimiterLog.upsert).mockResolvedValue({} as any);
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockApiKey.tenant as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupApiKeyMock();
  vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.idempotencyKey.create).mockResolvedValue({} as any);
});

describe('Diamond escrow.lock', () => {
  it('✅ 200 — lock com payload válido', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(mockAssetActive as any);
    vi.mocked(prisma.escrow.create).mockResolvedValue({ ...mockEscrowActive, chainTxId: null } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idempotency-lock-1')
      .send({
        selector: 'escrow.lock',
        payload: {
          assetId: 'asset-1',
          escrowId: 'esc-uuid-1',
          chain: 'SOLANA',
          sender: 'sender-wallet',
          receiver: 'receiver-wallet',
          amount: '1000000',
          unlockTimestamp: Math.floor(Date.now() / 1000) + 86400,
          releaseMode: 'MANUAL',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.escrowId).toBe('esc-uuid-1');
  });

  it('🚫 401 — sem API key', async () => {
    const res = await request(app)
      .post('/api/v1/diamond')
      .send({ selector: 'escrow.lock', payload: {} });

    expect(res.status).toBe(401);
  });
});

describe('Diamond escrow.release', () => {
  it('✅ 200 — release MANUAL por ADMIN', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({ ...mockEscrowActive, releaseMode: 'MANUAL' } as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'RELEASED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idempotency-release-1')
      .send({ selector: 'escrow.release', payload: { escrowId: 'esc-uuid-1', assetId: 'asset-1' } });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RELEASED');
  });
});

describe('Diamond escrow.cancel', () => {
  it('✅ 200 — cancel por ADMIN', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);
    vi.mocked(prisma.escrow.update).mockResolvedValue({ ...mockEscrowActive, status: 'CANCELLED' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idempotency-cancel-1')
      .send({ selector: 'escrow.cancel', payload: { escrowId: 'esc-uuid-1', assetId: 'asset-1' } });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });
});

describe('Diamond escrow.status', () => {
  it('✅ 200 — consulta status sem idempotência', async () => {
    vi.mocked(prisma.escrow.findFirst).mockResolvedValue(mockEscrowActive as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .send({ selector: 'escrow.status', payload: { escrowId: 'esc-uuid-1' } });

    expect(res.status).toBe(200);
    expect(res.body.data.escrowId).toBe('esc-uuid-1');
    expect(res.body.data.releaseMode).toBe('MANUAL');
  });
});
```

- [ ] **Step 2: Rodar testes**

```bash
npm test -- --run tests/escrow-diamond.test.ts
```

Saída esperada: todos os testes `✅ PASS`

- [ ] **Step 3: Commit**

```bash
git add tests/escrow-diamond.test.ts
git commit -m "test(escrow): add Diamond integration tests for escrow selectors"
```

---

## Task 8: Migração de rotas — Remover lifecycle e transfer REST dedicados

**Files:**
- Modify: `src/routes/index.ts`
- Delete: `src/routes/v1/lifecycleRoutes.ts`
- Delete: `src/controllers/LifecycleController.ts`
- Delete: `src/routes/v1/transferRoutes.ts`
- Delete: `src/controllers/TransferController.ts`

- [ ] **Step 1: Remover import e mount de lifecycleRoutes em routes/index.ts**

Em `src/routes/index.ts`, remova:

```typescript
// Remover esta linha do topo (imports):
import lifecycleRoutes from './v1/lifecycleRoutes';
```

E remova o bloco de mount:

```typescript
// Remover este bloco inteiro:
// Lifecycle State Machine — PATCH /api/v1/assets/:assetId/lifecycle
router.use('/v1/assets', lifecycleRoutes);
```

- [ ] **Step 2: Remover import e mount de transferRoutes (se existir em index.ts)**

Verifique se `transferRoutes` está montado em `src/routes/index.ts`. Se sim, remova o import e o `router.use`. Se não estiver montado, pule este step.

- [ ] **Step 3: Deletar arquivos de rotas e controllers**

```bash
rm src/routes/v1/lifecycleRoutes.ts
rm src/controllers/LifecycleController.ts
rm src/routes/v1/transferRoutes.ts
rm src/controllers/TransferController.ts
```

- [ ] **Step 4: Rodar todos os testes para confirmar sem regressões**

```bash
npm test -- --run
```

Saída esperada: todos os testes passando. Se algum teste importava diretamente os controllers removidos, atualize o import para a Facet correspondente.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove lifecycle and transfer REST routes — Diamond is now the sole gateway for domain mutations"
```

---

## Task 9: Testes Diamond pós-migração — lifecycle e transfer

**Files:**
- Create: `tests/lifecycle-diamond.test.ts`
- Create: `tests/transfer-diamond.test.ts`

- [ ] **Step 1: Criar tests/lifecycle-diamond.test.ts**

```typescript
// tests/lifecycle-diamond.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

vi.mock('../src/config/prisma', () => ({
  default: {
    apiKey: { findFirst: vi.fn() },
    rateLimiterLog: { findFirst: vi.fn(), upsert: vi.fn() },
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn() },
    asset: { findUnique: vi.fn(), update: vi.fn() },
    eventLog: { create: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

import prisma from '../src/config/prisma';

const mockApiKey = {
  id: 'key-1', keyHash: '$2b$10$placeholder', tenantId: 'tenant-1',
  role: 'ADMIN', isActive: true,
  tenant: { id: 'tenant-1', isActive: true, plan: 'PRO', targetChain: 'ALGORAND' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(mockApiKey as any);
  vi.mocked(prisma.rateLimiterLog.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.rateLimiterLog.upsert).mockResolvedValue({} as any);
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockApiKey.tenant as any);
  vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.idempotencyKey.create).mockResolvedValue({} as any);
});

describe('Diamond lifecycle.transition (pós-migração)', () => {
  it('✅ 200 — DRAFT → ACTIVE via Diamond', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1', tenantId: 'tenant-1', status: 'DRAFT',
    } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idempotency-lifecycle-1')
      .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'ACTIVE' } });

    expect(res.status).toBe(200);
    expect(res.body.data.currentState).toBe('ACTIVE');
  });

  it('🚫 422 — transição inválida DRAFT → BURNED', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1', tenantId: 'tenant-1', status: 'DRAFT',
    } as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idempotency-lifecycle-2')
      .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'BURNED' } });

    expect(res.status).toBe(422);
  });

  it('🚫 404 — rota REST antiga não existe mais', async () => {
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/lifecycle')
      .set('X-API-Key', 'qc_test_key')
      .send({ targetState: 'ACTIVE' });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Criar tests/transfer-diamond.test.ts**

```typescript
// tests/transfer-diamond.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

vi.mock('../src/config/prisma', () => ({
  default: {
    apiKey: { findFirst: vi.fn() },
    rateLimiterLog: { findFirst: vi.fn(), upsert: vi.fn() },
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn() },
    asset: { findUnique: vi.fn(), update: vi.fn() },
    owner: { findFirst: vi.fn(), create: vi.fn() },
    eventLog: { create: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

import prisma from '../src/config/prisma';

const mockApiKey = {
  id: 'key-1', keyHash: '$2b$10$placeholder', tenantId: 'tenant-1',
  role: 'ADMIN', isActive: true,
  tenant: { id: 'tenant-1', isActive: true, plan: 'PRO', targetChain: 'ALGORAND', customTransferFee: 49.99 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(mockApiKey as any);
  vi.mocked(prisma.rateLimiterLog.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.rateLimiterLog.upsert).mockResolvedValue({} as any);
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockApiKey.tenant as any);
  vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.idempotencyKey.create).mockResolvedValue({} as any);
});

describe('Diamond transfer.initiate (pós-migração)', () => {
  it('✅ 200 — transfer.initiate via Diamond', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1', tenantId: 'tenant-1', status: 'ACTIVE',
      tenant: mockApiKey.tenant,
    } as any);
    vi.mocked(prisma.owner.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.owner.create).mockResolvedValue({ id: 'owner-1' } as any);
    vi.mocked(prisma.asset.update).mockResolvedValue({} as any);
    vi.mocked(prisma.eventLog.create).mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/v1/diamond')
      .set('X-API-Key', 'qc_test_key')
      .set('X-Idempotency-Key', 'idempotency-transfer-1')
      .send({
        selector: 'transfer.initiate',
        payload: { assetId: 'asset-1', buyerDocument: '123.456.789-00', documentType: 'CPF' },
      });

    expect(res.status).toBe(200);
  });

  it('🚫 404 — rota REST antiga não existe mais', async () => {
    const res = await request(app)
      .patch('/api/v1/assets/asset-1/transfer')
      .set('X-API-Key', 'qc_test_key')
      .send({ buyerDocument: '123.456.789-00', documentType: 'CPF' });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Rodar testes**

```bash
npm test -- --run tests/lifecycle-diamond.test.ts tests/transfer-diamond.test.ts
```

Saída esperada: todos os testes `✅ PASS`

- [ ] **Step 4: Rodar suite completa**

```bash
npm test -- --run
```

Saída esperada: todos os testes passando sem regressões.

- [ ] **Step 5: Commit**

```bash
git add tests/lifecycle-diamond.test.ts tests/transfer-diamond.test.ts
git commit -m "test(diamond): add lifecycle and transfer Diamond integration tests post-migration"
```

---

## Task 10: Verificação final e push

- [ ] **Step 1: Rodar suite completa uma última vez**

```bash
npm test -- --run
```

Saída esperada: `Test Files X passed`, `Tests Y passed` — sem nenhuma falha.

- [ ] **Step 2: Verificar build TypeScript**

```bash
npm run build
```

Saída esperada: zero erros de tipo.

- [ ] **Step 3: Commit final (se houver arquivos soltos)**

```bash
git status
# Se houver algo pendente:
git add -A
git commit -m "chore(escrow): final cleanup and build verification"
```

- [ ] **Step 4: Push para o remote**

```bash
git push origin main
```

---

## Self-Review

**Cobertura do spec:**

| Requisito | Task |
|---|---|
| Campos `releaseMode` + `releaseConfirmedAt` no Escrow | Task 1 |
| `PROCESSING` adicionado ao `EscrowStatus` | Task 1 |
| `EscrowFacet.lock` com todas as validações | Task 2-3 |
| `EscrowFacet.release` (AUTO + MANUAL) | Task 2-3 |
| `EscrowFacet.cancel` (ADMIN only) | Task 2-3 |
| `EscrowFacet.getStatus` | Task 2-3 |
| `EscrowReleaseWorker` com overlap-lock, batch, isolamento | Task 4-5 |
| Seletores `escrow.*` no FacetRegistry | Task 6 |
| Cron no SchedulerService | Task 6 |
| `ESCROW_RELEASE_INTERVAL_SECONDS` em .env.example | Task 6 |
| Testes integração Diamond para 4 seletores escrow | Task 7 |
| Remoção de lifecycleRoutes + LifecycleController | Task 8 |
| Remoção de transferRoutes + TransferController | Task 8 |
| Remoção do mount em routes/index.ts | Task 8 |
| Teste que rota REST antiga retorna 404 | Task 9 |
| Teste lifecycle.transition via Diamond | Task 9 |
| Teste transfer.initiate via Diamond | Task 9 |

**Placeholders:** Nenhum — todo step contém código completo.

**Consistência de tipos:** `EscrowFacet` usa `SupportedChain` de `DLTAdapterFactory`, `TripleSignPayload` de `multi-chain/types`, mesmo padrão de `SecureContext` das demais facetas. `EscrowReleaseWorker` usa `WORKER_API_KEY_ID = 'ESCROW_WORKER'` constante compartilhada com `EscrowFacet`.
