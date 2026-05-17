# Phase 04: B2B Admin Operations Console - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 22 source files across `qc-backend` and `qc-dashboard`
**Analogs found:** 14 / 14 planned file groups

## File Classification

| New/Modified File Group | Role | Data Flow | Closest Analog | Match Quality |
|-------------------------|------|-----------|----------------|---------------|
| `prisma/schema.prisma` | model | relational/domain | `Tenant`, `ApiKey`, `AuditLog`, `Asset`, `Owner`, `EncodingSession` in `prisma/schema.prisma` | exact |
| `src/services/core-facets/AdminAuthorizationFacet.ts` | facet/service | request-response | `src/services/core-facets/ApiKeyManagementFacet.ts` | role-match |
| `src/middleware/platformAdminAuth.ts` | middleware | request-response | `src/middleware/apiKeyAuth.ts`, `src/middleware/rbacGuard.ts` | exact |
| `src/services/core-facets/AdminTenantOperationsFacet.ts` | facet/service | CRUD + audit | `src/services/core-facets/TenantManagementFacet.ts` | exact |
| `src/services/core-facets/AdminApiKeyOperationsFacet.ts` | facet/service | CRUD + audit | `src/services/core-facets/ApiKeyManagementFacet.ts` | exact |
| `src/middleware/apiRequestAudit.ts` | middleware | request audit | `src/middleware/apiKeyAuth.ts`, `src/controllers/WebhookController.ts` | role-match |
| `src/services/core-facets/CreditLedgerFacet.ts` | facet/service | ledger transaction | `src/services/core-facets/BillingFacet.ts`, `src/services/WalletService.ts` | partial |
| `src/services/core-facets/ReceivablesProviderFacet.ts` | facet/service | webhook/provider | `src/services/core-facets/BillingFacet.ts`, `src/controllers/WebhookController.ts` | role-match |
| `src/services/core-facets/QTagFulfillmentFacet.ts` | facet/service | queue + state machine | `src/services/core-facets/CommissioningFacet.ts` | role-match |
| `src/scripts/backfill-tenant-quantum.ts` | script | batch/idempotent migration | `src/scripts/validate-phase1.ts`, `../qc-dashboard/scripts/backfill-stellar-profile-identities.ts` | partial |
| `src/diamond/FacetRegistry.ts` | selector registry | dispatch | existing `FacetRegistry` selector map | exact |
| `src/routes/index.ts`, `src/routes/v1/adminRoutes.ts` | route | REST mount | `src/routes/index.ts`, `src/routes/v1/tenantRoutes.ts` | exact |
| `../qc-dashboard/server/services/qcBackendClient.ts` | backend client | request-response | existing `QCBackendClient` diamond/rawGet methods | exact |
| `../qc-dashboard/server/adminRouter.ts`, `../qc-dashboard/client/src/pages/admin/*` | tRPC/UI | admin shell/table flows | `../qc-dashboard/server/_core/trpc.ts`, `../qc-dashboard/client/src/App.tsx`, `../qc-dashboard/client/src/components/DashboardLayout.tsx` | exact |

## Pattern Assignments

### Backend Schema and Facets

**Analog:** `prisma/schema.prisma`

Use the existing singular PascalCase Prisma model style and tenant indexing:

```prisma
model Tenant {
  id           String  @id @default(cuid())
  slug         String  @unique
  apiKeys      ApiKey[]
  assets       Asset[]
  @@index([slug])
}
```

Phase 04 schema work should add canonical models for `TenantUser`, `ExternalIdentity`, `TenantMembership`, `TenantCommercialProfile`, `AdminAuditLog`, `ApiRequestAudit`, `PurchaseOrder`, `PaymentIntent`, `PaymentEvent`, `CreditLedgerEntry`, `QTagLedgerEntry`, `QTagFulfillmentOrder`, and `MigrationRun`/checkpoint/report records. Every tenant-owned table must include `tenantId` plus useful indexes.

**Analog:** `src/services/core-facets/TenantManagementFacet.ts`

Copy the facet/service structure:

```typescript
import prisma from '../../config/prisma';
import { AuditActions, ResourceTypes, DiamondFacets } from '../../types';

export class TenantManagementFacet {
  static async createTenant(params: {...}) {
    const tenant = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({ data: {...} });
      await tx.auditLog.create({ data: {...} });
      return newTenant;
    });
    return tenant;
  }
}
```

Admin tenant operations should keep controllers thin and put rules in facets/services. Privileged mutations must wrap state change plus audit entry in one transaction and require actor/reason metadata.

### Authorization and API-Key Patterns

**Analog:** `src/middleware/apiKeyAuth.ts`

Existing middleware injects request context from validated API key:

```typescript
req.tenantId = result.tenant.id;
req.apiKeyId = result.apiKeyId;
req.apiKeyRole = result.role;
req.apiKeyPrefix = result.apiKeyPrefix;
```

Phase 04 must not treat `ApiKeyRole.ADMIN` as Quantum Platform Admin. Add an explicit platform/tenant admin authorization layer based on canonical users/memberships and use it for admin routes and dashboard tRPC procedures.

**Analog:** `src/services/core-facets/ApiKeyManagementFacet.ts`

Copy the raw-key-once and hashed storage pattern:

```typescript
const rawKey = `qc_${env}_${crypto.randomBytes(32).toString('hex')}`;
const keyHash = await bcrypt.hash(rawKey, 10);
const keyPrefix = rawKey.substring(0, 16);
```

Phase 04 API-key operations must keep raw secret one-time only, store hash only, return prefix/metadata on list, and add scopes, actor ids, revocation reason and rotation lineage.

### Provider, Ledger and Webhook Patterns

**Analog:** `src/controllers/WebhookController.ts`

Provider webhooks must validate signatures before persistence and use inbox-style durability:

```typescript
await prisma.webhookInbox.create({
  data: {
    provider: 'MERCADOPAGO',
    rawPayload: req.body,
    status: 'PENDING',
  },
});
```

Phase 04 must generalize this behind `ReceivablesProvider`, `PaymentIntent` and `PaymentEvent`. Transfero stays a preferred candidate, but no Phase 04 code should hard-code Transfero-specific commercial behavior before `qc-business` confirms the contract.

**Analog:** `src/services/WalletService.ts`

Use `WalletService` only as a contrast pattern. It derives financial balance from deposits and chain transactions; Phase 04 credits must not extend this as the application credit source. Credit availability comes from immutable ledger entries (`PURCHASED`, `GRANTED`, `RESERVED`, `CONSUMED`, `RELEASED`, `REFUNDED`, `REVOKED`) and derived balance/projection.

### QTAG Fulfillment Patterns

**Analog:** `src/services/core-facets/CommissioningFacet.ts`

Commissioning already creates `EventLog`, `EncodingSession` and `Device`:

```typescript
await prisma.eventLog.create({ data: { tenantId: ctx.tenantId, assetId, origin: 'COMMISSIONING', ... } });
const session = await prisma.encodingSession.create({ data: { tenantId: ctx.tenantId, assetId, ntagUID: uid, status: 'IN_PROGRESS', ... } });
await prisma.device.upsert({ where: { uid }, create: {...}, update: {...} });
```

Phase 04 must add `QTagFulfillmentOrder` before commissioning, link `EncodingSession.fulfillmentOrderId`, allow retry attempts for the same asset, validate order/session/tenant/UID on confirm, link `Asset.deviceId`, and append QTAG ledger entries for reserve/release/consume.

### Dashboard Server Patterns

**Analog:** `../qc-dashboard/server/_core/trpc.ts`

Existing tRPC guards:

```typescript
export const protectedProcedure = t.procedure.use(requireUser);
export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    if (!ctx.user || ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);
```

Phase 04 should add stricter platform-admin and tenant-admin procedures instead of relying on `adminProcedure` alone. The dashboard should call backend admin contracts through `QCBackendClient.admin.*`, forwarding actor/reason/correlation metadata.

**Analog:** `../qc-dashboard/server/services/qcBackendClient.ts`

Use the existing `call(selector, payload)` and `rawGet(path)` pattern for backend integration. Add an `admin` namespace:

```typescript
admin = {
  platformTenantsList: (payload) => this.call('admin.tenants.list', payload),
  platformTenantActivate: (payload) => this.call('admin.tenants.activate', payload),
  ...
}
```

### Dashboard UI Patterns

**Analog:** `../qc-dashboard/client/src/App.tsx`

Routes are registered inside the protected `DashboardLayout`:

```tsx
<DashboardLayout>
  <Switch>
    <Route path="/assets" component={AssetsList} />
    <Route path="/store" component={Store} />
  </Switch>
</DashboardLayout>
```

Phase 04 should add `/admin/platform`, `/admin/platform/tenants`, queue routes, audit route and `/admin/tenant` inside the authenticated shell while preserving server-side guards.

**Analog:** `../qc-dashboard/client/src/components/DashboardLayout.tsx`

Reuse the sidebar shell, `wouter` navigation, lucide icons, shadcn sidebar/button/table/tabs/badge/dialog/sheet components. Admin pages must follow `04-UI-SPEC.md`: table-first, dense operational layout, no marketing hero, no nested cards, and explicit Platform Admin vs Tenant Admin scope marker.

## Shared Patterns

- Prisma schema changes require `npm run db:generate` and a schema push/migration task before verification.
- Every privileged backend mutation must include actor, tenant, reason when applicable, correlation id or payload hash, and an audit event.
- Tenant isolation must come from server-injected context or platform-admin authorization, never from a trusted request body `tenantId`.
- API request audit logs must never persist raw API keys, request bodies or sensitive payloads.
- Dashboard routes hiding nav items are not authorization; tRPC procedures and backend contracts must enforce scope.
- Credit and QTAG balances are projections from immutable ledgers; do not mutate simple counters as the source of truth.
- B2C Tenant Quantum/backfill/cutover is Phase 04; B2B external readiness is Phase 05.
