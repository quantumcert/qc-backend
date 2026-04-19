# Sub-sistema 1 — Core Gap Closure: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 4 production gaps in the Quantum Cert Diamond API: implement LifecycleFacet state machine, refactor TransferRegistryFacet to use CPF/CNPJ documents, add MercadoPago webhook with inbox pattern, and wire up AnchorQueueService with a cron scheduler and DLTAdapterFactory.

**Architecture:** Option C hybrid routing — lifecycle transitions via `PATCH /api/v1/assets/:assetId/lifecycle`, transfers via `PATCH /api/v1/assets/:assetId/transfer`, MP webhook via `POST /api/v1/webhooks/mercadopago`. All three routes use `requireApiKey + requireIdempotency + tenantRateLimiter`. Facets stay 100% agnostic (no domain-specific terms). AnchorQueueService moves from constructor-injected adapter to per-tenant chain resolution via DLTAdapterFactory.

**Tech Stack:** Node.js + TypeScript, Prisma (PostgreSQL), Express, vitest, node-cron, MercadoPago HMAC-SHA256

---

## File Map

**Modified:**
- `prisma/schema.prisma` — add DRAFT/SUSPENDED/ARCHIVED/LOCKED_IN_ESCROW to AssetStatus; add `document`/`documentType` to Owner; add `targetChain` to Tenant; add WebhookInbox model
- `src/services/core-facets/LifecycleFacet.ts` — replace empty `export {}` with full state machine
- `src/services/core-facets/TransferRegistryFacet.ts` — buyerEmail → buyerDocument/documentType; shadow account by document lookup
- `src/services/AnchorQueueService.ts` — remove constructor; make `processQueue` static; group events by chain via DLTAdapterFactory
- `src/diamond/FacetRegistry.ts` — add `lifecycle.transition` and `transfer.initiate`
- `src/routes/index.ts` — mount lifecycleRoutes, transferRoutes, webhookRoutes
- `src/server.ts` — call `SchedulerService.start()` after `app.listen()`
- `tests/facets.test.ts` — add `findFirst` to mockOwner; update TransferRegistryFacet test to new API
- `.env.example` — add `MP_WEBHOOK_SECRET` and `ANCHOR_QUEUE_INTERVAL_SECONDS`

**Created:**
- `src/controllers/LifecycleController.ts`
- `src/routes/v1/lifecycleRoutes.ts`
- `src/controllers/TransferController.ts`
- `src/routes/v1/transferRoutes.ts`
- `src/controllers/WebhookController.ts`
- `src/routes/v1/webhookRoutes.ts`
- `src/services/DLTAdapterFactory.ts`
- `src/services/SchedulerService.ts`
- `tests/lifecycle.test.ts`
- `tests/webhook.test.ts`
- `tests/dlt-adapter-factory.test.ts`
- `tests/scheduler.test.ts`

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Apply schema changes**

Replace the `AssetStatus` enum:

```prisma
enum AssetStatus {
  DRAFT
  ACTIVE
  SUSPENDED
  ARCHIVED
  BURNED
  AWAITING_PAYMENT
  LOCKED_IN_ESCROW
  // Legacy states — kept for backward compat with existing records
  ALERT
  INACTIVE
}
```

Add `document` and `documentType` fields to `Owner` model (after `ownerRef`):

```prisma
model Owner {
  id String @id @default(cuid())

  assetId String
  asset   Asset  @relation(fields: [assetId], references: [id], onDelete: Cascade)

  ownerRef String

  // Document-based identification (CPF/CNPJ for legal chain of custody)
  document     String?  // digits only, no mask (e.g. "12345678909")
  documentType String?  // 'CPF' | 'CNPJ'

  label String?

  sharePercent Decimal? @db.Decimal(6, 2)

  acquiredAt DateTime  @default(now())
  revokedAt  DateTime?

  @@unique([assetId, ownerRef])
  @@index([assetId])
  @@index([ownerRef])
  @@index([assetId, document])
}
```

Add `targetChain` to `Tenant` model (after `customTagFee`):

```prisma
  customTagFee      Float?

  // DLT chain for anchor routing (used by DLTAdapterFactory)
  targetChain String @default("ALGORAND")
```

Add `WebhookInbox` model at the end of the file (before the final closing):

```prisma
// ═══════════════════════════════════════════════════════════
// WEBHOOK INBOX — Inbox Pattern for external payment events
// Persisted before 200 OK to guarantee no lost payments on crash.
// ═══════════════════════════════════════════════════════════
model WebhookInbox {
  id           String    @id @default(cuid())
  provider     String    // 'MERCADOPAGO'
  rawPayload   Json      // raw payload received, never modified
  status       String    @default("PENDING") // PENDING | PROCESSING | DONE | FAILED
  retryCount   Int       @default(0)
  lastError    String?
  receivedAt   DateTime  @default(now())
  processedAt  DateTime?

  @@index([status, receivedAt])
}
```

- [ ] **Step 2: Run migration**

```bash
npm run db:migrate
# When prompted for migration name: core_gap_closure_schema
```

Expected output: `✓ Generated Prisma Client` and `The following migration was applied: core_gap_closure_schema`

- [ ] **Step 3: Regenerate Prisma client**

```bash
npm run db:generate
```

Expected: `✓ Generated Prisma Client (v5.x) to node_modules/@prisma/client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add lifecycle states, Owner.document, Tenant.targetChain, WebhookInbox"
```

---

## Task 2: Install node-cron

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install node-cron
npm install --save-dev @types/node-cron
```

- [ ] **Step 2: Verify**

```bash
node -e "const cron = require('node-cron'); console.log(cron.schedule.toString().slice(0, 50))"
```

Expected: prints beginning of schedule function definition (no error)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-cron dependency for SchedulerService"
```

---

## Task 3: LifecycleFacet — Write failing tests

**Files:**
- Create: `tests/lifecycle.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAsset, mockEventLog } = vi.hoisted(() => ({
    mockAsset: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    mockEventLog: {
        create: vi.fn(),
    },
}));

vi.mock('../src/config/prisma', () => ({
    default: {
        asset: mockAsset,
        eventLog: mockEventLog,
    }
}));

import { LifecycleFacet } from '../src/services/core-facets/LifecycleFacet';

const CTX_ADMIN    = { tenantId: 'tenant_001', apiKeyId: 'key_001', role: 'ADMIN' };
const CTX_OPERATOR = { tenantId: 'tenant_001', apiKeyId: 'key_001', role: 'OPERATOR' };

const DRAFT_ASSET     = { id: 'asset_001', tenantId: 'tenant_001', status: 'DRAFT' };
const ACTIVE_ASSET    = { ...DRAFT_ASSET, status: 'ACTIVE' };
const SUSPENDED_ASSET = { ...DRAFT_ASSET, status: 'SUSPENDED' };
const ESCROW_ASSET    = { ...DRAFT_ASSET, status: 'LOCKED_IN_ESCROW' };
const AWAITING_ASSET  = { ...DRAFT_ASSET, status: 'AWAITING_PAYMENT' };

describe('LifecycleFacet.transition', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('✅ DRAFT → ACTIVE (OPERATOR allowed)', async () => {
        mockAsset.findUnique.mockResolvedValue(DRAFT_ASSET);
        mockAsset.update.mockResolvedValue({ ...DRAFT_ASSET, status: 'ACTIVE' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_001' });

        const result = await LifecycleFacet.transition(CTX_OPERATOR, {
            assetId: 'asset_001', targetState: 'ACTIVE', reason: 'activation'
        });

        expect(result.currentState).toBe('ACTIVE');
        expect(result.previousState).toBe('DRAFT');
        expect(mockAsset.update).toHaveBeenCalledWith({
            where: { id: 'asset_001' },
            data: { status: 'ACTIVE' }
        });
        expect(mockEventLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                payload: expect.objectContaining({
                    action: 'LIFECYCLE_TRANSITION',
                    fromState: 'DRAFT',
                    toState: 'ACTIVE',
                    reason: 'activation',
                })
            })
        }));
    });

    it('✅ ACTIVE → SUSPENDED (ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);
        mockAsset.update.mockResolvedValue({ ...ACTIVE_ASSET, status: 'SUSPENDED' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_002' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'SUSPENDED'
        });

        expect(result.currentState).toBe('SUSPENDED');
    });

    it('✅ SUSPENDED → ACTIVE (reactivation, ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(SUSPENDED_ASSET);
        mockAsset.update.mockResolvedValue({ ...SUSPENDED_ASSET, status: 'ACTIVE' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_003' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ACTIVE'
        });

        expect(result.currentState).toBe('ACTIVE');
    });

    it('✅ ACTIVE → BURNED (terminal, ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);
        mockAsset.update.mockResolvedValue({ ...ACTIVE_ASSET, status: 'BURNED' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_004' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'BURNED'
        });

        expect(result.currentState).toBe('BURNED');
        expect(mockAsset.update).toHaveBeenCalled();
    });

    it('✅ ACTIVE → ARCHIVED (ADMIN)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);
        mockAsset.update.mockResolvedValue({ ...ACTIVE_ASSET, status: 'ARCHIVED' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_005' });

        const result = await LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ARCHIVED'
        });

        expect(result.currentState).toBe('ARCHIVED');
    });

    it('🚫 LOCKED_IN_ESCROW → any throws ASSET_LOCKED_IN_ESCROW (HTTP 423)', async () => {
        mockAsset.findUnique.mockResolvedValue(ESCROW_ASSET);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ACTIVE'
        })).rejects.toMatchObject({
            code: 'ASSET_LOCKED_IN_ESCROW',
            httpStatus: 423,
        });

        expect(mockAsset.update).not.toHaveBeenCalled();
        expect(mockEventLog.create).not.toHaveBeenCalled();
    });

    it('🚫 AWAITING_PAYMENT → ACTIVE throws STATE_TRANSITION_FORBIDDEN (HTTP 422)', async () => {
        mockAsset.findUnique.mockResolvedValue(AWAITING_ASSET);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'ACTIVE'
        })).rejects.toMatchObject({
            code: 'STATE_TRANSITION_FORBIDDEN',
            httpStatus: 422,
        });
    });

    it('🚫 DRAFT → BURNED is not a valid transition (HTTP 422)', async () => {
        mockAsset.findUnique.mockResolvedValue(DRAFT_ASSET);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'asset_001', targetState: 'BURNED'
        })).rejects.toMatchObject({
            code: 'STATE_TRANSITION_FORBIDDEN',
            httpStatus: 422,
        });
    });

    it('🚫 ACTIVE → ARCHIVED requires ADMIN — OPERATOR rejected (HTTP 403)', async () => {
        mockAsset.findUnique.mockResolvedValue(ACTIVE_ASSET);

        await expect(LifecycleFacet.transition(CTX_OPERATOR, {
            assetId: 'asset_001', targetState: 'ARCHIVED'
        })).rejects.toMatchObject({
            code: 'INSUFFICIENT_ROLE_FOR_TRANSITION',
            httpStatus: 403,
        });

        expect(mockAsset.update).not.toHaveBeenCalled();
    });

    it('🚫 Asset not found throws ASSET_NOT_FOUND', async () => {
        mockAsset.findUnique.mockResolvedValue(null);

        await expect(LifecycleFacet.transition(CTX_ADMIN, {
            assetId: 'nonexistent', targetState: 'ACTIVE'
        })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    });

    it('✅ EventLog payload includes reason: null when reason is omitted', async () => {
        mockAsset.findUnique.mockResolvedValue(DRAFT_ASSET);
        mockAsset.update.mockResolvedValue({ ...DRAFT_ASSET, status: 'ACTIVE' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_006' });

        await LifecycleFacet.transition(CTX_ADMIN, { assetId: 'asset_001', targetState: 'ACTIVE' });

        expect(mockEventLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                payload: expect.objectContaining({ reason: null })
            })
        }));
    });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- lifecycle
```

Expected: `FAIL tests/lifecycle.test.ts` — all tests fail because `LifecycleFacet` is `export {}`

---

## Task 4: LifecycleFacet — Implementation

**Files:**
- Modify: `src/services/core-facets/LifecycleFacet.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/services/core-facets/LifecycleFacet.ts
import prisma from '../../config/prisma';

interface SecureContext {
    tenantId: string;
    apiKeyId: string;
    role: string;
}

interface LifecyclePayload {
    assetId: string;
    targetState: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'BURNED';
    reason?: string;
}

// Transition matrix: fromState → { allowed targets, allowed roles }
const TRANSITION_RULES: Record<string, { targets: string[]; roles: string[] }> = {
    DRAFT:    { targets: ['ACTIVE'],                          roles: ['ADMIN', 'OPERATOR'] },
    ACTIVE:   { targets: ['SUSPENDED', 'ARCHIVED', 'BURNED'], roles: ['ADMIN'] },
    SUSPENDED:{ targets: ['ACTIVE'],                          roles: ['ADMIN'] },
};

function makeError(message: string, code: string, httpStatus: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.httpStatus = httpStatus;
    return err;
}

export class LifecycleFacet {
    static async transition(secureContext: SecureContext, payload: LifecyclePayload) {
        const { tenantId, apiKeyId, role } = secureContext;
        const { assetId, targetState, reason } = payload;

        const asset = await prisma.asset.findUnique({
            where: { id: assetId, tenantId },
        });

        if (!asset) {
            throw makeError('Asset not found or access denied', 'ASSET_NOT_FOUND', 404);
        }

        const fromState = asset.status as string;

        if (fromState === 'LOCKED_IN_ESCROW') {
            throw makeError(
                'Asset is locked in escrow. Only EscrowFacet can release it.',
                'ASSET_LOCKED_IN_ESCROW',
                423
            );
        }

        const rules = TRANSITION_RULES[fromState];

        if (!rules || !rules.targets.includes(targetState)) {
            throw makeError(
                `Transition ${fromState} → ${targetState} is not allowed`,
                'STATE_TRANSITION_FORBIDDEN',
                422
            );
        }

        if (!rules.roles.includes(role)) {
            throw makeError(
                `Role ${role} cannot perform transition ${fromState} → ${targetState}`,
                'INSUFFICIENT_ROLE_FOR_TRANSITION',
                403
            );
        }

        await prisma.asset.update({
            where: { id: assetId },
            data: { status: targetState as any },
        });

        await prisma.eventLog.create({
            data: {
                assetId,
                tenantId,
                origin: apiKeyId,
                status: 'APPROVED',
                payload: {
                    action: 'LIFECYCLE_TRANSITION',
                    fromState,
                    toState: targetState,
                    reason: reason ?? null,
                },
            },
        });

        return { assetId, previousState: fromState, currentState: targetState };
    }
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npm test -- lifecycle
```

Expected: `PASS tests/lifecycle.test.ts` — all 10 tests green

- [ ] **Step 3: Commit**

```bash
git add src/services/core-facets/LifecycleFacet.ts tests/lifecycle.test.ts
git commit -m "feat(lifecycle): implement LifecycleFacet state machine with full transition matrix"
```

---

## Task 5: LifecycleController + Route

**Files:**
- Create: `src/controllers/LifecycleController.ts`
- Create: `src/routes/v1/lifecycleRoutes.ts`

- [ ] **Step 1: Create LifecycleController**

```typescript
// src/controllers/LifecycleController.ts
import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { LifecycleFacet } from '../services/core-facets/LifecycleFacet';

const TransitionSchema = z.object({
    targetState: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BURNED']),
    reason: z.string().max(500).optional(),
});

export class LifecycleController {
    static async transition(req: AuthenticatedRequest, res: Response) {
        try {
            const { assetId } = req.params;
            const body = TransitionSchema.parse(req.body);

            const secureContext = {
                tenantId: req.tenantId!,
                apiKeyId: req.apiKeyId!,
                role: req.apiKeyRole as string,
            };

            const result = await LifecycleFacet.transition(secureContext, { assetId, ...body });

            return res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return res.status(400).json({ success: false, error: error.errors });
            }
            const status = error.httpStatus ?? 400;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }
    }
}
```

- [ ] **Step 2: Create lifecycleRoutes**

```typescript
// src/routes/v1/lifecycleRoutes.ts
import { Router } from 'express';
import { LifecycleController } from '../../controllers/LifecycleController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

const router = Router();

// PATCH /api/v1/assets/:assetId/lifecycle
router.patch('/:assetId/lifecycle',
    requireApiKey,
    requireIdempotency,
    tenantRateLimiter,
    requireOperator,
    LifecycleController.transition
);

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/LifecycleController.ts src/routes/v1/lifecycleRoutes.ts
git commit -m "feat(lifecycle): add LifecycleController and PATCH /assets/:assetId/lifecycle route"
```

---

## Task 6: TransferRegistryFacet — Update tests to new API

**Files:**
- Modify: `tests/facets.test.ts`

The existing test uses `buyerEmail`. After the refactor the API changes to `buyerDocument + documentType`. Also, the facet will call `owner.findFirst` (new) before `owner.create`.

- [ ] **Step 1: Add `findFirst` to mockOwner and update the TransferRegistryFacet test**

In `tests/facets.test.ts`, locate the `vi.hoisted` block and add `findFirst` to `mockOwner`:

```typescript
// Change this:
    mockOwner: {
        create: vi.fn(),
    },

// To this:
    mockOwner: {
        create: vi.fn(),
        findFirst: vi.fn(),
    },
```

Locate the `FACETA 2: TransferRegistryFacet` describe block and replace its contents:

```typescript
describe('FACETA 2: TransferRegistryFacet — Transferência e Billing', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('✅ Inicia transferência com documento CPF (novo comprador — cria Shadow Account)', async () => {
        mockAsset.findUnique.mockResolvedValue(BICYCLE);
        mockOwner.findFirst.mockResolvedValue(null); // no existing owner with this doc
        mockOwner.create.mockResolvedValue({ id: 'owner_shadow_001' });
        mockAsset.update.mockResolvedValue({ ...BICYCLE, status: 'AWAITING_PAYMENT' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_transfer_001' });

        const result = await TransferRegistryFacet.initiateTransfer(
            SECURE_CONTEXT,
            { assetId: BICYCLE.id, buyerDocument: '123.456.789-09', documentType: 'CPF' }
        );

        expect(result.assetId).toBe(BICYCLE.id);
        expect(result.status).toBe('AWAITING_PAYMENT');
        expect(result.paymentLink).toBe('https://pagamento.link');
        expect(result.buyerDocument).toBe('12345678909'); // normalized — mask removed
        expect(result.documentType).toBe('CPF');
        expect(result.buyerOwnerId).toBe('owner_shadow_001');
        expect(mockOwner.findFirst).toHaveBeenCalledOnce();
        expect(mockOwner.create).toHaveBeenCalledOnce();
        expect(mockAsset.update).toHaveBeenCalledOnce();
        expect(mockEventLog.create).toHaveBeenCalledOnce();
    });

    it('✅ Reutiliza Shadow Account existente (mesmo CPF)', async () => {
        mockAsset.findUnique.mockResolvedValue(BICYCLE);
        mockOwner.findFirst.mockResolvedValue({ id: 'owner_existing_001' }); // already exists
        mockAsset.update.mockResolvedValue({ ...BICYCLE, status: 'AWAITING_PAYMENT' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_transfer_002' });

        const result = await TransferRegistryFacet.initiateTransfer(
            SECURE_CONTEXT,
            { assetId: BICYCLE.id, buyerDocument: '12345678909', documentType: 'CPF' }
        );

        expect(result.buyerOwnerId).toBe('owner_existing_001');
        expect(mockOwner.create).not.toHaveBeenCalled(); // no duplicate creation
    });

    it('🚫 Rejeita quando ativo não está ACTIVE', async () => {
        mockAsset.findUnique.mockResolvedValue({ ...BICYCLE, status: 'AWAITING_PAYMENT' });

        await expect(TransferRegistryFacet.initiateTransfer(
            SECURE_CONTEXT,
            { assetId: BICYCLE.id, buyerDocument: '12345678909', documentType: 'CPF' }
        )).rejects.toMatchObject({ code: 'INVALID_ASSET_STATE' });
    });
});
```

- [ ] **Step 2: Run to confirm the updated tests fail**

```bash
npm test -- facets
```

Expected: the TransferRegistryFacet describe block fails (old implementation doesn't match new test)

---

## Task 7: TransferRegistryFacet — Refactor implementation

**Files:**
- Modify: `src/services/core-facets/TransferRegistryFacet.ts`

- [ ] **Step 1: Rewrite the facet**

```typescript
// src/services/core-facets/TransferRegistryFacet.ts
import prisma from '../../config/prisma';
import { BillingFacet } from './BillingFacet';

interface SecureContext {
    tenantId: string;
    apiKeyId?: string;
    role: string;
}

interface TransferPayload {
    assetId: string;
    buyerDocument: string;    // CPF or CNPJ, may have mask
    documentType: 'CPF' | 'CNPJ';
}

export class TransferRegistryFacet {
    static async initiateTransfer(secureContext: SecureContext, payload: TransferPayload) {
        const { tenantId, apiKeyId, role } = secureContext;
        const { assetId, documentType } = payload;

        // Normalize: strip mask characters (dots, dashes, slashes)
        const buyerDocument = payload.buyerDocument.replace(/\D/g, '');

        if (role !== 'ADMIN' && role !== 'OPERATOR') {
            const err: any = new Error('Forbidden: Insufficient privileges to initiate transfer');
            err.code = 'INSUFFICIENT_PERMISSIONS';
            throw err;
        }

        const asset = await prisma.asset.findUnique({
            where: { id: assetId, tenantId },
            include: { tenant: true },
        });

        if (!asset) {
            const err: any = new Error('Asset not found or access denied');
            err.code = 'ASSET_NOT_FOUND';
            throw err;
        }

        if (asset.status !== 'ACTIVE') {
            const err: any = new Error(`Asset cannot be transferred from state: ${asset.status}`);
            err.code = 'INVALID_ASSET_STATE';
            throw err;
        }

        const fee = (asset.tenant as any).customTransferFee || 49.99;

        // Shadow Account: lookup or create by document within this asset
        let owner = await prisma.owner.findFirst({
            where: { assetId, document: buyerDocument },
        });

        if (!owner) {
            owner = await prisma.owner.create({
                data: {
                    assetId,
                    ownerRef: buyerDocument,
                    document: buyerDocument,
                    documentType,
                    label: 'Shadow Account (Pending Payment)',
                },
            });
        }

        await prisma.asset.update({
            where: { id: asset.id },
            data: { status: 'AWAITING_PAYMENT' },
        });

        await prisma.eventLog.create({
            data: {
                assetId: asset.id,
                tenantId: asset.tenantId,
                origin: apiKeyId || 'MANUAL',
                status: 'APPROVED',
                payload: {
                    action: 'TRANSFER_INITIATED',
                    buyerDocument,
                    documentType,
                    fee,
                    buyerOwnerId: owner.id,
                },
            },
        });

        const billing = await BillingFacet.createPaymentPreference(secureContext, {
            assetId: asset.id,
            title: `Ownership Transfer: ${asset.externalId}`,
            amount: fee,
            ownerEmail: buyerDocument, // BillingFacet uses this as payer reference
        });

        return {
            assetId: asset.id,
            status: 'AWAITING_PAYMENT',
            paymentLink: billing.initPoint,
            buyerDocument,
            documentType,
            buyerOwnerId: owner.id,
        };
    }
}
```

- [ ] **Step 2: Run all unit tests**

```bash
npm test
```

Expected: all tests green (lifecycle.test.ts + updated facets.test.ts)

- [ ] **Step 3: Commit**

```bash
git add src/services/core-facets/TransferRegistryFacet.ts tests/facets.test.ts
git commit -m "feat(transfer): refactor TransferRegistryFacet — buyerDocument/documentType, shadow account by CPF/CNPJ"
```

---

## Task 8: TransferController + Route

**Files:**
- Create: `src/controllers/TransferController.ts`
- Create: `src/routes/v1/transferRoutes.ts`

- [ ] **Step 1: Create TransferController**

```typescript
// src/controllers/TransferController.ts
import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { TransferRegistryFacet } from '../services/core-facets/TransferRegistryFacet';

const TransferSchema = z.object({
    buyerDocument: z.string().min(11).max(18), // 11 digits CPF or 14 digits CNPJ (with or without mask)
    documentType: z.enum(['CPF', 'CNPJ']),
});

export class TransferController {
    static async initiate(req: AuthenticatedRequest, res: Response) {
        try {
            const { assetId } = req.params;
            const body = TransferSchema.parse(req.body);

            const secureContext = {
                tenantId: req.tenantId!,
                apiKeyId: req.apiKeyId!,
                role: req.apiKeyRole as string,
            };

            const result = await TransferRegistryFacet.initiateTransfer(secureContext, {
                assetId,
                ...body,
            });

            return res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return res.status(400).json({ success: false, error: error.errors });
            }
            const status = error.httpStatus ?? 400;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }
    }
}
```

- [ ] **Step 2: Create transferRoutes**

```typescript
// src/routes/v1/transferRoutes.ts
import { Router } from 'express';
import { TransferController } from '../../controllers/TransferController';
import { requireApiKey } from '../../middleware/apiKeyAuth';
import { requireOperator } from '../../middleware/rbacGuard';
import { tenantRateLimiter } from '../../middleware/rateLimiter';
import { requireIdempotency } from '../../middleware/idempotencyGuard';

const router = Router();

// PATCH /api/v1/assets/:assetId/transfer
router.patch('/:assetId/transfer',
    requireApiKey,
    requireIdempotency,
    tenantRateLimiter,
    requireOperator,
    TransferController.initiate
);

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/TransferController.ts src/routes/v1/transferRoutes.ts
git commit -m "feat(transfer): add TransferController and PATCH /assets/:assetId/transfer route"
```

---

## Task 9: WebhookController — Write failing tests

**Files:**
- Create: `tests/webhook.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/webhook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { mockWebhookInbox } = vi.hoisted(() => ({
    mockWebhookInbox: { create: vi.fn() },
}));

vi.mock('../src/config/prisma', () => ({
    default: { webhookInbox: mockWebhookInbox }
}));

import { WebhookController } from '../src/controllers/WebhookController';

const SECRET = 'test_webhook_secret_32chars_exact';

function buildSignature(paymentId: string, requestId: string, ts: string, secret = SECRET): string {
    const template = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const hash = crypto.createHmac('sha256', secret).update(template).digest('hex');
    return `ts=${ts},v1=${hash}`;
}

function makeReq(overrides: Partial<{
    headers: Record<string, string>;
    query: Record<string, string>;
    body: Record<string, unknown>;
}> = {}) {
    const ts = '1744000000000';
    const paymentId = 'PAY_001';
    const requestId = 'REQ_abc123';

    return {
        headers: {
            'x-signature': buildSignature(paymentId, requestId, ts),
            'x-request-id': requestId,
            ...overrides.headers,
        },
        query: { 'data.id': paymentId, ts, ...overrides.query },
        body: { action: 'payment.created', data: { id: paymentId }, ...overrides.body },
    };
}

function makeRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe('WebhookController.handleMercadoPago', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MP_WEBHOOK_SECRET = SECRET;
    });

    it('✅ Persists valid webhook to WebhookInbox and returns 200', async () => {
        mockWebhookInbox.create.mockResolvedValue({ id: 'inbox_001' });
        const req = makeReq() as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true });
        expect(mockWebhookInbox.create).toHaveBeenCalledWith({
            data: {
                provider: 'MERCADOPAGO',
                rawPayload: req.body,
                status: 'PENDING',
            }
        });
    });

    it('🚫 Returns 401 and does NOT persist if HMAC signature is invalid', async () => {
        const req = makeReq({
            headers: {
                'x-signature': 'ts=1744000000000,v1=deadbeefdeadbeef',
                'x-request-id': 'REQ_abc123',
            }
        }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockWebhookInbox.create).not.toHaveBeenCalled();
    });

    it('🚫 Returns 401 when x-signature header is missing', async () => {
        const req = makeReq({ headers: { 'x-request-id': 'REQ_abc123' } }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockWebhookInbox.create).not.toHaveBeenCalled();
    });

    it('🚫 Returns 401 when data.id query param is missing', async () => {
        const req = makeReq({ query: { ts: '1744000000000' } }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('🛡️ Does NOT persist before HMAC validation (no persisted-then-rejected race)', async () => {
        // Signature tampered with wrong secret
        const req = makeReq({
            headers: {
                'x-signature': buildSignature('PAY_001', 'REQ_abc123', '1744000000000', 'wrong_secret'),
                'x-request-id': 'REQ_abc123',
            }
        }) as any;
        const res = makeRes();

        await WebhookController.handleMercadoPago(req, res);

        expect(mockWebhookInbox.create).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- webhook
```

Expected: `FAIL tests/webhook.test.ts` — `WebhookController` does not exist yet

---

## Task 10: WebhookController + Route — Implementation

**Files:**
- Create: `src/controllers/WebhookController.ts`
- Create: `src/routes/v1/webhookRoutes.ts`

- [ ] **Step 1: Create WebhookController**

```typescript
// src/controllers/WebhookController.ts
import crypto from 'crypto';
import { Request, Response } from 'express';
import prisma from '../config/prisma';

export class WebhookController {
    static async handleMercadoPago(req: Request, res: Response) {
        const signature = req.headers['x-signature'] as string | undefined;
        const requestId = req.headers['x-request-id'] as string | undefined;
        const paymentId = req.query['data.id'] as string | undefined;
        const ts        = req.query['ts'] as string | undefined;

        if (!signature || !requestId || !paymentId || !ts) {
            return res.status(401).json({ success: false, error: 'Missing required webhook headers or query params' });
        }

        const secret = process.env.MP_WEBHOOK_SECRET;
        if (!secret) {
            console.error('[Webhook] MP_WEBHOOK_SECRET is not configured');
            return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
        }

        // Parse signature header: "ts=<ts>,v1=<hash>"
        const parts: Record<string, string> = {};
        for (const part of signature.split(',')) {
            const [key, value] = part.split('=');
            if (key && value) parts[key.trim()] = value.trim();
        }

        const receivedV1 = parts['v1'];
        if (!receivedV1) {
            return res.status(401).json({ success: false, error: 'Invalid signature format' });
        }

        // Reconstruct template and compute expected HMAC
        const template = `id:${paymentId};request-id:${requestId};ts:${ts};`;
        const expectedHash = crypto
            .createHmac('sha256', secret)
            .update(template)
            .digest('hex');

        // Timing-safe comparison to prevent timing attacks
        let receivedBuf: Buffer;
        let expectedBuf: Buffer;
        try {
            receivedBuf = Buffer.from(receivedV1, 'hex');
            expectedBuf = Buffer.from(expectedHash, 'hex');
        } catch {
            return res.status(401).json({ success: false, error: 'Invalid signature encoding' });
        }

        if (expectedBuf.length !== receivedBuf.length ||
            !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
            return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
        }

        // Inbox Pattern: persist BEFORE responding 200
        // If process crashes after this write, the event is recoverable.
        await prisma.webhookInbox.create({
            data: {
                provider: 'MERCADOPAGO',
                rawPayload: req.body,
                status: 'PENDING',
            },
        });

        return res.status(200).json({ success: true });
    }
}
```

- [ ] **Step 2: Create webhookRoutes**

```typescript
// src/routes/v1/webhookRoutes.ts
import { Router } from 'express';
import { WebhookController } from '../../controllers/WebhookController';

const router = Router();

// POST /api/v1/webhooks/mercadopago
// No apiKeyAuth — external provider call. HMAC validation is inside the controller.
router.post('/mercadopago', WebhookController.handleMercadoPago);

export default router;
```

- [ ] **Step 3: Run tests**

```bash
npm test -- webhook
```

Expected: `PASS tests/webhook.test.ts` — all 5 tests green

- [ ] **Step 4: Commit**

```bash
git add src/controllers/WebhookController.ts src/routes/v1/webhookRoutes.ts tests/webhook.test.ts
git commit -m "feat(webhook): add WebhookController with HMAC-SHA256 validation and inbox persistence"
```

---

## Task 11: DLTAdapterFactory — Write failing tests

**Files:**
- Create: `tests/dlt-adapter-factory.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/dlt-adapter-factory.test.ts
import { describe, it, expect } from 'vitest';
import { DLTAdapterFactory } from '../src/services/DLTAdapterFactory';

describe('DLTAdapterFactory.getAdapter', () => {
    it('✅ Returns an IDLTAdapter for ALGORAND', () => {
        const adapter = DLTAdapterFactory.getAdapter('ALGORAND');

        expect(adapter).toBeDefined();
        expect(typeof adapter.anchorEvent).toBe('function');
        expect(typeof adapter.verifyAnchor).toBe('function');
    });

    it('🚫 Throws for SOLANA (not yet implemented)', () => {
        expect(() => DLTAdapterFactory.getAdapter('SOLANA' as any))
            .toThrow('DLT adapter not implemented for chain: SOLANA');
    });

    it('🚫 Throws for POLYGON (not yet implemented)', () => {
        expect(() => DLTAdapterFactory.getAdapter('POLYGON' as any))
            .toThrow('DLT adapter not implemented for chain: POLYGON');
    });

    it('✅ Returns a new instance per call (no singleton leak)', () => {
        const a = DLTAdapterFactory.getAdapter('ALGORAND');
        const b = DLTAdapterFactory.getAdapter('ALGORAND');
        expect(a).not.toBe(b);
    });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- dlt-adapter-factory
```

Expected: `FAIL` — `DLTAdapterFactory` does not exist

---

## Task 12: DLTAdapterFactory — Implementation

**Files:**
- Create: `src/services/DLTAdapterFactory.ts`

- [ ] **Step 1: Create the factory**

```typescript
// src/services/DLTAdapterFactory.ts
import { IDLTAdapter } from '../interfaces/IDLTAdapter';
import { AlgorandAnchorFacet } from './core-facets/AlgorandAnchorFacet';

// Add new chains here as Sub-sistema 2 adapters are implemented.
// import { SolanaAdapter } from './adapters/SolanaAdapter';
// import { PolygonAdapter } from './adapters/PolygonAdapter';
// import { StellarAdapter } from './adapters/StellarAdapter';

export type SupportedChain = 'ALGORAND' | 'SOLANA' | 'POLYGON' | 'ETHEREUM' | 'STELLAR';

export class DLTAdapterFactory {
    /**
     * Returns the IDLTAdapter for the specified chain.
     * Called by AnchorQueueService per-batch — never in server startup.
     * AnchorQueueService and SchedulerService never instantiate adapters directly.
     */
    static getAdapter(targetChain: SupportedChain): IDLTAdapter {
        switch (targetChain) {
            case 'ALGORAND':
                return new AlgorandAnchorFacet();
            // case 'SOLANA':   return new SolanaAdapter();   // Sub-sistema 2
            // case 'POLYGON':  return new PolygonAdapter();  // Sub-sistema 2
            // case 'STELLAR':  return new StellarAdapter();  // Sub-sistema 2
            default:
                throw new Error(`DLT adapter not implemented for chain: ${targetChain}`);
        }
    }
}
```

- [ ] **Step 2: Run tests**

```bash
npm test -- dlt-adapter-factory
```

Expected: `PASS tests/dlt-adapter-factory.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/services/DLTAdapterFactory.ts tests/dlt-adapter-factory.test.ts
git commit -m "feat(dlt): add DLTAdapterFactory — pluggable chain resolution for AnchorQueueService"
```

---

## Task 13: SchedulerService — Write failing tests

**Files:**
- Create: `tests/scheduler.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/scheduler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-cron before any imports that use it
const mockCronSchedule = vi.fn();
vi.mock('node-cron', () => ({
    default: { schedule: mockCronSchedule },
    schedule: mockCronSchedule,
}));

// Mock AnchorQueueService
const mockProcessQueue = vi.fn().mockResolvedValue({ processed: 0, items: [] });
vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: { processQueue: mockProcessQueue }
}));

import { SchedulerService } from '../src/services/SchedulerService';

describe('SchedulerService.start', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.ANCHOR_QUEUE_INTERVAL_SECONDS;
    });

    it('✅ Registers a cron job with default 30s interval', () => {
        SchedulerService.start();
        expect(mockCronSchedule).toHaveBeenCalledWith('*/30 * * * * *', expect.any(Function));
    });

    it('✅ Respects ANCHOR_QUEUE_INTERVAL_SECONDS env var', () => {
        process.env.ANCHOR_QUEUE_INTERVAL_SECONDS = '60';
        SchedulerService.start();
        expect(mockCronSchedule).toHaveBeenCalledWith('*/60 * * * * *', expect.any(Function));
    });

    it('✅ Calls AnchorQueueService.processQueue when cron fires', async () => {
        SchedulerService.start();
        const cronCallback = mockCronSchedule.mock.calls[0][1];
        await cronCallback();
        expect(mockProcessQueue).toHaveBeenCalledOnce();
    });

    it('🛡️ Skips concurrent run if queue is already processing (overlap lock)', async () => {
        SchedulerService.start();
        const cronCallback = mockCronSchedule.mock.calls[0][1];

        // First call starts and holds
        let resolveFirst!: () => void;
        const slowFirst = new Promise<void>(r => { resolveFirst = r; });
        mockProcessQueue.mockReturnValueOnce(slowFirst);

        const first = cronCallback(); // sets isRunning = true
        await Promise.resolve();      // yield so the flag is set

        const second = cronCallback(); // should skip — isRunning is true
        await Promise.resolve();

        resolveFirst();
        await Promise.all([first, second]);

        expect(mockProcessQueue).toHaveBeenCalledTimes(1); // second was skipped
    });

    it('🛡️ Resets lock after processQueue throws (error recovery)', async () => {
        SchedulerService.start();
        const cronCallback = mockCronSchedule.mock.calls[0][1];

        mockProcessQueue.mockRejectedValueOnce(new Error('DLT timeout'));
        await cronCallback(); // throws internally, must not leave isRunning=true

        mockProcessQueue.mockResolvedValueOnce({ processed: 0, items: [] });
        await cronCallback(); // must run (lock was released)

        expect(mockProcessQueue).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- scheduler
```

Expected: `FAIL tests/scheduler.test.ts` — `SchedulerService` does not exist

---

## Task 14: SchedulerService — Implementation

**Files:**
- Create: `src/services/SchedulerService.ts`

- [ ] **Step 1: Create SchedulerService**

```typescript
// src/services/SchedulerService.ts
import cron from 'node-cron';
import { AnchorQueueService } from './AnchorQueueService';

export class SchedulerService {
    /**
     * Registers all cron jobs. Called once after server startup.
     * Contains no business logic — only timing triggers.
     * Blockchain resolution happens inside AnchorQueueService per-event.
     */
    static start(): void {
        const intervalSeconds = parseInt(process.env.ANCHOR_QUEUE_INTERVAL_SECONDS ?? '30', 10);
        const cronPattern = `*/${intervalSeconds} * * * * *`;

        let isRunning = false;

        cron.schedule(cronPattern, async () => {
            if (isRunning) {
                console.log('[Scheduler] AnchorQueue already running, skipping this cycle.');
                return;
            }
            isRunning = true;
            try {
                await AnchorQueueService.processQueue();
            } catch (err) {
                console.error('[Scheduler] AnchorQueue error:', err);
            } finally {
                isRunning = false;
            }
        });

        console.log(`[Scheduler] AnchorQueue cron started — interval: ${intervalSeconds}s (pattern: ${cronPattern})`);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
npm test -- scheduler
```

Expected: `PASS tests/scheduler.test.ts` — all 4 tests green

- [ ] **Step 3: Commit**

```bash
git add src/services/SchedulerService.ts tests/scheduler.test.ts
git commit -m "feat(scheduler): add SchedulerService — cron trigger for AnchorQueueService"
```

---

## Task 15: AnchorQueueService — Refactor to static + DLTAdapterFactory

**Files:**
- Modify: `src/services/AnchorQueueService.ts`

The current implementation takes `adapter: IDLTAdapter` in its constructor. Refactor to:
- Remove constructor
- Make `processQueue` static
- Include `tenant.targetChain` in the Prisma query
- Group events by chain using a Map
- Resolve adapter via `DLTAdapterFactory.getAdapter(chain)` per group

- [ ] **Step 1: Rewrite AnchorQueueService**

```typescript
// src/services/AnchorQueueService.ts
import prisma from '../config/prisma';
import { DLTAdapterFactory, SupportedChain } from './DLTAdapterFactory';
import { WebhookDispatcher } from '../utils/WebhookDispatcher';

export class AnchorQueueService {
    /**
     * Processes the queue of APPROVED events that do not yet have a DLT TxID.
     * Groups events by tenant chain to minimize adapter instantiations per batch.
     */
    static async processQueue() {
        const pendingEvents = await prisma.eventLog.findMany({
            where: {
                status: { in: ['APPROVED', 'PENDING_FUNDS'] },
                dltTxId: null,
                signatureHash: { not: null },
            },
            include: {
                tenant: { select: { targetChain: true } },
            },
            orderBy: { id: 'asc' }, // FIFO
            take: 10,
        });

        if (pendingEvents.length === 0) {
            console.log('[AnchorQueue] No pending events to anchor.');
            return { processed: 0, items: [] };
        }

        // Atomic row lock — prevents double-spend across workers
        const lockedEvents: typeof pendingEvents = [];
        for (const event of pendingEvents) {
            const lockResult = await prisma.eventLog.updateMany({
                where: { id: event.id, dltTxId: null },
                data: { dltTxId: 'PROCESSING' },
            });
            if (lockResult.count > 0) lockedEvents.push(event);
        }

        if (lockedEvents.length === 0) {
            console.log('[AnchorQueue] All candidate events were locked by another worker.');
            return { processed: 0, items: [] };
        }

        console.log(`[AnchorQueue] Locked ${lockedEvents.length} events for anchoring.`);

        // Group by chain to minimize adapter instantiations
        const byChain = new Map<string, typeof lockedEvents>();
        for (const event of lockedEvents) {
            const chain = (event.tenant?.targetChain as string) ?? 'ALGORAND';
            if (!byChain.has(chain)) byChain.set(chain, []);
            byChain.get(chain)!.push(event);
        }

        const results: Array<{ id: string; txId?: string; success: boolean; error?: string }> = [];

        for (const [chain, events] of byChain) {
            const adapter = DLTAdapterFactory.getAdapter(chain as SupportedChain);

            for (const event of events) {
                try {
                    const txId = await adapter.anchorEvent(event.id, event.signatureHash!);

                    await prisma.eventLog.update({
                        where: { id: event.id },
                        data: { dltTxId: txId },
                    });

                    console.log(`[AnchorQueue] Event ${event.id} anchored on ${chain}. TxID: ${txId}`);

                    await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_SUCCESS', {
                        eventId: event.id,
                        assetId: event.assetId,
                        dltTxId: txId,
                        status: 'APPROVED',
                        signatureHash: event.signatureHash,
                    });

                    results.push({ id: event.id, txId, success: true });
                } catch (error: any) {
                    console.error(`[AnchorQueue] Failed to anchor Event ${event.id}:`, error.stack || error);

                    if (error.message.includes('Insufficient funds') || error.message.includes('PENDING_FUNDS')) {
                        await prisma.eventLog.updateMany({
                            where: { id: event.id, dltTxId: 'PROCESSING' },
                            data: { dltTxId: null, status: 'PENDING_FUNDS' as any },
                        });
                    } else {
                        await prisma.eventLog.updateMany({
                            where: { id: event.id, dltTxId: 'PROCESSING' },
                            data: { dltTxId: 'FAILED_TIMEOUT' },
                        });

                        await WebhookDispatcher.dispatch(event.tenantId, 'ANCHOR_FAILED', {
                            eventId: event.id,
                            assetId: event.assetId,
                            status: 'DLQ',
                            errorReason: error.message,
                        });
                    }

                    results.push({ id: event.id, success: false, error: error.message });
                }
            }
        }

        return { processed: lockedEvents.length, items: results };
    }
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests green (lifecycle, facets, webhook, dlt-adapter-factory, scheduler, security-regression)

- [ ] **Step 3: Commit**

```bash
git add src/services/AnchorQueueService.ts
git commit -m "refactor(anchor): AnchorQueueService — static processQueue, DLTAdapterFactory per-tenant chain routing"
```

---

## Task 16: Integration — FacetRegistry + Routes + Server

**Files:**
- Modify: `src/diamond/FacetRegistry.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Register new selectors in FacetRegistry**

Add imports at the top of `src/diamond/FacetRegistry.ts`:

```typescript
import { LifecycleFacet } from '../services/core-facets/LifecycleFacet';
import { TransferRegistryFacet } from '../services/core-facets/TransferRegistryFacet';
```

Add selectors to the `FacetRegistry` object (after `'publicProfile.filter'`):

```typescript
    // LIFECYCLE STATE MACHINE
    'lifecycle.transition': LifecycleFacet.transition,

    // TRANSFER REGISTRY
    'transfer.initiate': TransferRegistryFacet.initiateTransfer,
```

- [ ] **Step 2: Mount routes in routes/index.ts**

Add imports after existing route imports:

```typescript
import lifecycleRoutes from './v1/lifecycleRoutes';
import transferRoutes from './v1/transferRoutes';
import webhookRoutes from './v1/webhookRoutes';
```

Add mounts after `router.use('/v1/devices', deviceRoutes)`:

```typescript
// ═══════════════════════════════════════════════════════════
// SUB-SISTEMA 1: Core Gap Closure
// ═══════════════════════════════════════════════════════════

// Lifecycle State Machine — PATCH /api/v1/assets/:assetId/lifecycle
router.use('/v1/assets', lifecycleRoutes);

// Ownership Transfer — PATCH /api/v1/assets/:assetId/transfer
router.use('/v1/assets', transferRoutes);

// MercadoPago Webhook — POST /api/v1/webhooks/mercadopago
router.use('/v1/webhooks', webhookRoutes);
```

- [ ] **Step 3: Start SchedulerService in server.ts**

Add import after existing imports in `src/server.ts`:

```typescript
import { SchedulerService } from './services/SchedulerService';
```

Replace the `app.listen` call:

```typescript
app.listen(PORT, () => {
  // ... existing console.log startup banner ...

  // Start anchor queue cron (only in non-test environments)
  if (process.env.NODE_ENV !== 'test') {
    SchedulerService.start();
  }
});
```

- [ ] **Step 4: Build to check TypeScript**

```bash
npm run build
```

Expected: `dist/` generated with zero TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/diamond/FacetRegistry.ts src/routes/index.ts src/server.ts
git commit -m "feat(integration): wire lifecycle/transfer/webhook routes, FacetRegistry selectors, SchedulerService startup"
```

---

## Task 17: Environment Variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add new variables to .env.example**

Find the section with existing env vars and append:

```bash
# ── Sub-sistema 1: Core Gap Closure ──────────────────────────
# MercadoPago webhook HMAC secret (required for /api/v1/webhooks/mercadopago)
MP_WEBHOOK_SECRET=

# AnchorQueueService cron interval in seconds (default: 30)
ANCHOR_QUEUE_INTERVAL_SECONDS=30
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): document MP_WEBHOOK_SECRET and ANCHOR_QUEUE_INTERVAL_SECONDS"
```

---

## Task 18: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all test files pass with zero failures

- [ ] **Step 2: TypeScript build**

```bash
npm run build
```

Expected: `dist/` generated, zero errors

- [ ] **Step 3: Smoke test server startup (optional, requires .env)**

```bash
npm run dev
```

Expected: server starts, `[Scheduler] AnchorQueue cron started — interval: 30s` appears in stdout, `/health` returns `200 OK`

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: final adjustments from full integration verification"
```

---

## Self-Review

### Spec coverage check

| Spec Section | Covered by Task |
|---|---|
| LifecycleFacet state machine (DRAFT→ACTIVE→SUSPENDED→ARCHIVED→BURNED) | Tasks 3–5 |
| LOCKED_IN_ESCROW blocks all transitions (HTTP 423) | Task 3–4 |
| AWAITING_PAYMENT not directly transitionable | Task 3–4 |
| Role matrix (ADMIN/OPERATOR per transition) | Task 3–4 |
| EventLog created on every transition | Task 3–4 |
| reason stored in EventLog, never in DLT note | Task 3–4 (payload contains reason; AnchorQueue hashes the whole payload — SHA3 goes to DLT only) |
| TransferRegistryFacet buyerDocument/documentType | Tasks 6–8 |
| Document normalization (strip mask) in TransferController | Task 8 |
| Shadow Account — lookup by document before create | Tasks 6–7 |
| REST route PATCH /assets/:assetId/transfer | Task 8 |
| PATCH /assets/:assetId/lifecycle | Task 5 |
| MercadoPago HMAC-SHA256 validation | Tasks 9–10 |
| Inbox Pattern — persist before 200 OK | Tasks 9–10 |
| POST /webhooks/mercadopago (no apiKeyAuth) | Task 10 |
| IDLTAdapter / DLTAdapterFactory | Tasks 11–12 |
| DLTAdapterFactory.getAdapter(chain) | Tasks 11–12 |
| SchedulerService — cron, overlap lock | Tasks 13–14 |
| ANCHOR_QUEUE_INTERVAL_SECONDS env | Task 14 |
| AnchorQueueService — static, DLTAdapterFactory, group-by-chain | Task 15 |
| FacetRegistry — lifecycle.transition, transfer.initiate | Task 16 |
| routes/index.ts mounts | Task 16 |
| SchedulerService.start() in server.ts | Task 16 |
| WebhookInbox schema model | Task 1 |
| AssetStatus new values | Task 1 |
| Owner.document/documentType | Task 1 |
| Tenant.targetChain | Task 1 |
| MP_WEBHOOK_SECRET, ANCHOR_QUEUE_INTERVAL_SECONDS in .env.example | Task 17 |
| node-cron installed | Task 2 |

**No gaps found.**

### Notes on out-of-scope items (per spec)

- `BillingFacet.processWebhookInbox` (reading WebhookInbox to confirm payment) — NOT in this plan. WebhookController writes to inbox; processing is a separate concern (BillingFacet or a future worker).
- `IDLTAdapter` Buffer refactor (spec Section 4 proposed interface) — deferred to Sub-sistema 2. Current interface uses `(eventId: string, hash: string)` and is kept as-is.
- DLT adapters for Solana, Stellar, Polygon — Sub-sistema 2.
