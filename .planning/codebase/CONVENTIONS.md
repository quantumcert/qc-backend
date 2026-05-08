# Coding Conventions

_Generated: 2026-05-08 | Focus: quality_

## Summary

The codebase uses TypeScript with strict mode enabled, organized around a Diamond Pattern where all business logic lives in pure Facet classes. No linter (ESLint/Prettier) is configured — style is enforced only by `tsc --strict`. Conventions are consistent and deliberately minimal: static-only classes for Facets, Zod for validation at controller boundaries, domain-specific Error subclasses per Facet, and a structured banner comment at the top of every file.

---

## File Header Convention

Every source file begins with a banner comment block identifying its role:

```typescript
// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: TenantManagementFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Responsibility: [what this module owns]
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════
```

Section separators within files use:

```typescript
// ─── SECTION NAME ────────────────────────────────────────
```

---

## Naming Patterns

**Files:**
- PascalCase for classes: `AssetRegistryFacet.ts`, `TenantManagementFacet.ts`
- PascalCase for controllers: `AssetController.ts`, `ApiKeyController.ts`
- camelCase for middleware: `apiKeyAuth.ts`, `rateLimiter.ts`, `rbacGuard.ts`
- camelCase for utilities: `errorHandler.ts`, `idempotencyGuard.ts`

**Classes:**
- Facets: `[Domain]Facet` — e.g. `AssetRegistryFacet`, `LifecycleFacet`
- Controllers: `[Domain]Controller` — e.g. `AssetController`, `TenantController`
- Services: `[Domain]Service` — e.g. `AnchorQueueService`, `SchedulerService`
- Errors: `[Domain]Error` — e.g. `TenantError`, `ApiKeyError`, `AgentError`

**Methods:**
- camelCase verbs: `createAsset`, `validateApiKey`, `processQueue`, `initiateTransfer`
- Static methods only on Facets — no instance methods

**Constants / Enums:**
- SCREAMING_SNAKE_CASE for object keys: `ASSET_CREATED`, `TENANT_NOT_FOUND`
- PascalCase for exported `const` objects: `DiamondFacets`, `AuditActions`, `PLAN_TIER_LIMITS`, `RBAC_HIERARCHY`

**Types/Interfaces:**
- PascalCase: `AuthenticatedRequest`, `ApiResponse<T>`, `NfcTapResult`

---

## Facet Class Pattern

All Facets are static-only classes (no constructor, no instance state):

```typescript
export class AssetRegistryFacet {
    static async createAsset(secureContext: { tenantId?: string; role?: string }, payload: CreateAssetPayload) {
        // secureContext ALWAYS first, payload ALWAYS second
        ...
    }
}
```

- `secureContext` is the first parameter on every Facet method
- `payload` is always the second parameter
- Facets must never import Express types — they are pure service classes
- Facets are registered in `src/diamond/FacetRegistry.ts` using dot-notation selectors (`'asset.create'`, `'lifecycle.transition'`)

---

## Controller Pattern

Controllers are thin: parse → call Facet → respond. Error propagation uses `next(err)`:

```typescript
export class AssetController {
    static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const body = CreateAssetSchema.parse(req.body);    // Zod parse first
            const asset = await AssetRegistryFacet.createAsset(
                { tenantId: req.tenantId, role: req.apiKeyRole },
                body
            );
            const response: ApiResponse = {
                success: true,
                data: asset,
                meta: { timestamp: new Date().toISOString(), facet: DiamondFacets.ASSET_REGISTRY }
            };
            res.status(201).json(response);
        } catch (err) {
            next(err);    // always delegate to errorHandler
        }
    }
}
```

---

## API Response Envelope

All responses use the `ApiResponse<T>` interface from `src/types/index.ts`:

```typescript
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    meta?: {
        timestamp: string;
        facet: string;
        requestId?: string;
    };
}
```

Error responses always include `{ success: false, error: string }`. Error responses with a known code also include `{ code: string }`.

---

## Input Validation

Validation uses Zod at the controller boundary, before the Facet call:

```typescript
const CreateAssetSchema = z.object({
    externalId: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', ...]).optional()
});

const body = CreateAssetSchema.parse(req.body);  // throws ZodError on invalid input
```

Zod schemas are defined locally in each controller file. No shared schema registry.

---

## Error Handling

**Domain Errors:** Each Facet module exports a typed error class with a string `code`:

```typescript
export class TenantError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'TenantError';
    }
}
```

Existing error classes:
- `TenantError` — `src/services/core-facets/TenantManagementFacet.ts`
- `ApiKeyError` — `src/services/core-facets/ApiKeyManagementFacet.ts`
- `AgentError` — `src/services/core-facets/AgentRegistryFacet.ts`

**Centralized handler:** `src/middleware/errorHandler.ts` handles all errors. It maps known error types to HTTP status codes using `Record<string, number>` lookup tables. Unknown errors return 500 with message hidden in production.

**Middleware errors:** Inline `try/catch` in middleware files with direct `res.status(N).json(...)` returns (not `next(err)`) for auth/rate-limit errors.

---

## Import Organization

```typescript
// 1. Node built-ins (rare — only in utility scripts)
import path from 'path';

// 2. Third-party packages
import { Response, NextFunction } from 'express';
import { z } from 'zod';

// 3. Internal: config
import prisma from '../../config/prisma';

// 4. Internal: types
import { AuthenticatedRequest, DiamondFacets, ApiResponse } from '../../types';

// 5. Internal: other modules
import { AssetRegistryFacet } from '../services/core-facets/AssetRegistryFacet';
```

No path aliases are configured. All imports use relative paths (`../../`, `../`).

---

## Logging

No structured logging library. All logging uses `console.log` / `console.error` with bracketed prefixes:

```typescript
console.log('[AnchorQueue] No pending events to anchor.');
console.error('[ApiKeyAuth] Unexpected error:', error);
console.error('[ErrorHandler] ${err.name}: ${err.message}');
```

Pattern: `[ModuleName] message`. No log levels beyond info/error.

---

## TypeScript Configuration

From `tsconfig.json`:
- `target: ES2022`, `module: commonjs`
- `strict: true` — all strict checks enabled
- `esModuleInterop: true`
- No path aliases (`@/` etc.)
- `declaration: true`, `sourceMap: true`
- `tests/` is excluded from `tsc` compilation (tests run via vitest directly)

---

## Comments

**When to comment:**
- Section headers for logical blocks within a file (using `// ─── NAME ────` pattern)
- JSDoc `/** */` on public static methods of Facets and Services
- Inline `//` for non-obvious business logic (e.g., lock semantics, LGPD rationale)

**What NOT to comment:**
- Obvious code (`// Validate slug uniqueness` before a findUnique call is acceptable)
- Architecture decisions belong in `CLAUDE.md`, not inline

---

## Prisma Usage

- Single Prisma client instance exported from `src/config/prisma.ts`
- `$transaction(async (tx) => {...})` pattern for multi-write operations
- Tenant isolation enforced via `where: { ..., tenantId }` on every query
- Never trust `tenantId` from request body — always use `secureContext.tenantId` injected by middleware

---

## Gaps / Unknowns

- No ESLint or Prettier configuration detected. Style consistency relies on TypeScript strict mode and conventions.
- No barrel `index.ts` files in `core-facets/` — each Facet is imported directly by path.
- No shared Zod schema registry — schemas are duplicated across controllers where needed.
