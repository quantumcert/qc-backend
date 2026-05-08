# Testing Patterns

_Generated: 2026-05-08 | Focus: quality_

## Summary

The project uses Vitest with 30 test files located in `tests/`. Tests are separated into two tiers: unit tests that mock Prisma entirely and call Facets directly, and integration-style tests that mount the full Express `app` via `supertest` with mocked middleware. A dedicated security regression suite tests IDOR and RBAC invariants. No E2E tests against a live database exist beyond the `test:e2e` script entry (which points to a single file).

---

## Test Framework

**Runner:** Vitest `^1.0.4`
**Config:** `vitest.config.ts` (project root)
**Assertion:** Vitest built-in (`expect`)
**HTTP testing:** `supertest ^7.2.2`

**Key vitest.config.ts settings:**
- `pool: 'forks'` with `singleFork: true` — all tests run in a single forked process (prevents port conflicts and WASM re-initialization)
- `server.deps.inline: ['uuid']` — `uuid` inlined to avoid CJS/ESM conflict
- Module aliases for `@stellar/stellar-sdk` pointing to `__mocks__/` — Stellar SDK replaced with a stub globally

**Run Commands:**
```bash
npm test              # vitest (watch mode)
npm run test:e2e      # vitest run tests/e2e.test.ts  (one-shot, single file)
```

---

## Test File Organization

**Location:** All test files live in `tests/` at the project root (separate from `src/`).

**Naming:** `[subject].test.ts` — flat, no subdirectories.

**Test files inventory:**
| File | What it covers |
|------|----------------|
| `tests/facets.test.ts` | AssetRegistryFacet, TransferRegistryFacet, EventLogFacet, PublicProfileFacet, BlindContactLogFacet |
| `tests/lifecycle-diamond.test.ts` | LifecycleFacet state transitions via Diamond endpoint |
| `tests/transfer-diamond.test.ts` | TransferRegistryFacet via Diamond endpoint |
| `tests/security-regression.test.ts` | Anti-IDOR, RBAC enforcement, DoS payload limit, state machine bypass |
| `tests/post-quantum-crypto.test.ts` | Falcon-512 sign/verify (real WASM — no mock) |
| `tests/agent-event.test.ts` | AgentController + requireAgentSignature middleware |
| `tests/agent-registry.test.ts` | AgentRegistryFacet |
| `tests/commissioning.test.ts` | CommissioningFacet (QTAG provisioning) |
| `tests/sdm-verifier.test.ts` | SDMVerifierService (NFC CMAC validation) |
| `tests/escrow-facet.test.ts` | EscrowFacet |
| `tests/escrow-release-worker.test.ts` | EscrowReleaseWorker |
| `tests/scheduler.test.ts` | SchedulerService |
| `tests/wallet.test.ts` | WalletService |
| `tests/deposit-flow.test.ts` | Deposit flow integration |
| `tests/asset-controller.test.ts` | AssetController REST endpoints |
| `tests/document-verification.test.ts` | DocumentVerificationFacet |
| `tests/blockchain-observer.test.ts` | Blockchain observer |
| `tests/qtag-crypto.test.ts` | QTAG cryptographic operations |
| `tests/webhook.test.ts` | WebhookDispatcher |
| `tests/docs.test.ts` | OpenAPI docs endpoint |

---

## Test Structure: Unit Tests (Facet-level)

Facet tests mock Prisma entirely using `vi.hoisted()` and call static Facet methods directly:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Declare mock objects with vi.hoisted() so they're available before imports
const { mockAsset, mockAuditLog } = vi.hoisted(() => ({
    mockAsset: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    mockAuditLog: { create: vi.fn() },
}));

// 2. Mock Prisma before importing Facets
vi.mock('../src/config/prisma', () => ({
    default: {
        asset: mockAsset,
        auditLog: mockAuditLog,
        $transaction: vi.fn(async (cb) => await cb({ asset: mockAsset, auditLog: mockAuditLog })),
    }
}));

// 3. Import Facets AFTER mocks
import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';

// 4. Reset mocks between tests
beforeEach(() => { vi.clearAllMocks(); });

describe('AssetRegistryFacet', () => {
    it('✅ Cria Asset com tenant e owners', async () => {
        mockAsset.create.mockResolvedValue(BICYCLE);
        const result = await AssetRegistryFacet.createAsset(SECURE_CONTEXT, ASSET_PAYLOAD);
        expect(result.status).toBe('ACTIVE');
        expect(mockAsset.create).toHaveBeenCalledOnce();
    });

    it('🚫 Rejeita acesso sem ser ADMIN', async () => {
        await expect(AssetRegistryFacet.createAsset({ tenantId: 'x', role: 'STANDARD' }, ASSET_PAYLOAD))
            .rejects.toThrow(/insufficient privileges/i);
    });
});
```

**Fixture pattern:** Inline `const` objects defined at module level (not factory functions):
```typescript
const SECURE_CONTEXT = { tenantId: 'tenant_001', role: 'ADMIN' };
const BICYCLE = { id: 'asset_bike_001', tenantId: 'tenant_001', status: 'ACTIVE', ... };
```

---

## Test Structure: Integration Tests (HTTP-level)

Integration tests mount the full Express `app` and use `supertest`. Middleware is mocked to bypass auth:

```typescript
import request from 'supertest';

// Mock auth middleware before importing app
vi.mock('../src/middleware/apiKeyAuth', () => ({
    requireApiKey: (req: any, res: any, next: any) => {
        if (!req.headers['x-api-key']) return res.status(401).json({ success: false, error: 'Unauthorized' });
        req.tenantId = 'tenant-1';
        req.apiKeyRole = 'ADMIN';
        next();
    },
    optionalApiKey: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/config/prisma', () => ({ default: { asset: { findUnique: vi.fn() }, ... } }));

// Import app AFTER mocks
import { app } from '../src/server';

it('✅ 200 — DRAFT → ACTIVE via Diamond', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({ id: 'asset-1', status: 'DRAFT' } as any);

    const res = await request(app)
        .post('/api/v1/diamond')
        .set('X-API-Key', 'qc_test_key')
        .send({ selector: 'lifecycle.transition', payload: { assetId: 'asset-1', targetState: 'ACTIVE' } });

    expect(res.status).toBe(200);
    expect(res.body.data.currentState).toBe('ACTIVE');
});
```

**Critical ordering:** `vi.mock(...)` calls must appear before `import { app }` — Vitest hoists mock declarations automatically, but the import of `app` must be after the mock declarations in source order.

---

## Mocking

**Framework:** Vitest `vi.mock()` / `vi.fn()` / `vi.hoisted()`

**What is mocked:**
- `src/config/prisma` — in every test that touches data layer (mocked as flat object with `vi.fn()` per method)
- `src/middleware/apiKeyAuth` — in integration tests (bypasses auth, injects known context)
- `src/utils/PostQuantumCrypto` — in agent/M2M tests (controls verify output)
- `src/services/AnchorQueueService` — in Facet tests (prevents side effects)
- `src/services/core-facets/BillingFacet` — in TransferRegistry tests (mocks payment link)
- `@stellar/stellar-sdk` — globally via `vitest.config.ts` alias pointing to `__mocks__/@stellar/stellar-sdk.ts`
- `algosdk` — via `__mocks__/algosdk.ts`

**What is NOT mocked (real implementations):**
- `falcon-crypto` WASM — `tests/post-quantum-crypto.test.ts` runs against the real library
- Zod validation — always real
- Business logic inside Facets — always real in unit tests

---

## Test Naming Convention

Test names use emoji prefixes for quick visual scanning:
- `✅` — happy path / expected success
- `🚫` — rejection / guard / error case

```typescript
it('✅ Cria Asset com tenant e owners', ...)
it('🚫 Rejeita acesso sem ser ADMIN', ...)
it('🚫 400 — transição inválida DRAFT → BURNED retorna código de erro', ...)
```

---

## Security Regression Tests

`tests/security-regression.test.ts` is a dedicated red-team suite that verifies security invariants:

- **Anti-IDOR:** Tenant A key cannot modify Tenant B asset — verified via `secureContext.tenantId` scoping
- **State machine bypass:** Cannot update a `BURNED` asset (terminal state)
- **DoS limit:** Payload > 600KB must return >= 413
- **RBAC enforcement:** `READER` role cannot call `asset.create`

Note: several assertions in this file currently expect `status: 500` with `{ error: 'Internal Server Error' }` for what should be 403/404 responses, indicating known gaps in error mapping (see CONCERNS.md).

---

## Coverage

**Requirements:** None enforced (no coverage thresholds configured)

**View Coverage:**
```bash
npx vitest run --coverage
```

No coverage configuration in `vitest.config.ts`.

---

## Gaps / Unknowns

- **No E2E tests against real DB:** `npm run test:e2e` references `tests/e2e.test.ts` which does not exist in the file listing — this script likely fails or is a placeholder.
- **No coverage thresholds:** Coverage is not collected or enforced in CI.
- **Middleware untested in isolation:** `rateLimiter.ts`, `rbacGuard.ts`, `idempotencyGuard.ts` have no dedicated test files.
- **Missing Facet tests:** `RateLimiterFacet`, `NfcValidationFacet`, `ContextRouterFacet`, `PublicProfileFacet` (beyond the one assertion in `facets.test.ts`) have minimal or no dedicated tests.
- **Security regression assertions are weak:** Several tests accept `500` responses where typed `403`/`404` would be more correct — the test suite documents current behavior rather than desired behavior in those cases.
- **No test for `AnchorQueueService` actual anchoring path** — only the mock stub is tested indirectly.
