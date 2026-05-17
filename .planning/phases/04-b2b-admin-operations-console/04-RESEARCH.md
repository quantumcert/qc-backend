# Phase 4: B2B Admin Operations Console - Research

**Date:** 2026-05-17
**Mode:** Research first, with subagent findings synthesized by orchestrator
**Status:** Ready for UI-SPEC gate before planning

## Research Objective

Answer what the planner needs to know before creating executable plans for Phase 4:

- how to evolve `qc-backend` from tenant/API-key primitives into a B2B operational admin foundation;
- how to expose `/admin/platform` and `/admin/tenant` in `qc-dashboard` without relying on UI-only authorization;
- how to model credits, receivables, QTAG entitlements and fulfillment without custodial client-wallet assumptions;
- how to handle the user's confirmed decision that Tenant Quantum, complete B2C backfill and B2C cutover must be absorbed by Phase 4, leaving Phase 5 for B2B external readiness.

## Sources Read

### Planning

- `.planning/phases/04-b2b-admin-operations-console/04-CONTEXT.md`
- `.planning/phases/04-b2b-admin-operations-console/04-SPEC.md`
- `.planning/phases/05-unified-tenant-identity-data-backfill/05-SPEC.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `.planning/PROJECT.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STRUCTURE.md`
- `.planning/codebase/INTEGRATIONS.md`

### Backend Code

- `prisma/schema.prisma`
- `src/services/core-facets/TenantManagementFacet.ts`
- `src/services/core-facets/ApiKeyManagementFacet.ts`
- `src/services/core-facets/CommissioningFacet.ts`
- `src/services/core-facets/DeviceRegistryFacet.ts`
- `src/services/core-facets/BillingFacet.ts`
- `src/middleware/apiKeyAuth.ts`
- `src/middleware/rbacGuard.ts`
- `src/controllers/TenantController.ts`
- `src/controllers/ApiKeyController.ts`
- `src/controllers/WalletController.ts`
- `src/controllers/WebhookController.ts`
- `src/routes/v1/tenantRoutes.ts`
- `src/routes/v1/apiKeyRoutes.ts`
- `src/routes/v1/walletRoutes.ts`
- `src/routes/v1/webhookRoutes.ts`
- `src/diamond/DiamondProxy.ts`
- `src/services/WalletService.ts`
- `src/services/SDMVerifierService.ts`

### Cross-Repo Code

- `../qc-dashboard/server/_core/trpc.ts`
- `../qc-dashboard/server/_core/context.ts`
- `../qc-dashboard/server/routers.ts`
- `../qc-dashboard/server/services/qcBackendClient.ts`
- `../qc-dashboard/server/wallet.credits.test.ts`
- `../qc-dashboard/drizzle/schema.ts`
- `../qc-dashboard/client/src/App.tsx`
- `../qc-dashboard/client/src/components/DashboardLayout.tsx`
- `../qc-dashboard/client/src/pages/Store.tsx`
- `../qc-dashboard/client/src/components/CartSheet.tsx`
- `../qc-record-module-node/src/backend/diamondClient.js`
- `../qc-record-module-node/src/provisioner.js`

## Executive Findings

Phase 4 is not a simple admin UI. It is a cross-repo platform foundation phase.

The current backend already has useful primitives:

- `Tenant`
- `ApiKey`
- `AuditLog`
- tenant-scoped Diamond/facet pattern
- `Device`
- `EncodingSession`
- `EventLog`
- webhook inbox/payment precedent
- wallet/deposit infrastructure

But these primitives are not sufficient for the approved Phase 4 model:

- `ApiKeyRole.ADMIN` is a technical tenant API role, not a Quantum Platform Admin.
- `Tenant.isActive` is too weak for `draft`, `pending_review`, `active`, `suspended`, `archived`.
- there is no canonical backend user/membership model for Platform Admin or Tenant Admin.
- there is no request audit for API calls by tenant/API key.
- there is no credit ledger.
- there is no QTAG entitlement ledger.
- there is no QTAG fulfillment order/fila operacional.
- there is no generic receivables provider contract.
- there is no backend user model to execute complete Tenant Quantum backfill.

The planner must not treat these as UI tasks. The first plans need backend contracts, schema, authorization, audit and migration foundations before the dashboard can be a trustworthy operations surface.

## Scope Alignment Decision: Phase 4 vs Phase 5

The user confirmed `10B`: execute complete Tenant Quantum/backfill in Phase 4. The follow-up correction is that Phase 5 should be left for B2B, not for B2C cutover.

Updated planning implication:

1. Phase 4 planning must include Tenant Quantum creation, canonical B2C user/membership models, migration engine, complete dashboard user/dependent backfill, B2C ownership/credit migration and B2C cutover to backend contracts.
2. Phase 5 must not duplicate the B2C Tenant Quantum/backfill path. It should focus on B2B external readiness: tenant admins/operators, tenant API consumption, white-label/public boundary and B2B pilot cutover.
3. Do not create implementation plans that move B2B external-readiness work into Phase 4 unless required as foundation for the admin console.

Recommended target boundary:

- Phase 4: admin B2B foundation, canonical membership/user foundation required for admin/backfill, credit/QTAG/provider foundations, Tenant Quantum creation, migration engine, complete B2C backfill execution report, B2C cutover and admin operational UI.
- Phase 5: B2B external tenant readiness, tenant admin/operator lifecycle, tenant API consumption, white-label/public boundary, commercial packaging confirmation and B2B pilot UAT.

## Backend Architecture Findings

### Existing Patterns To Reuse

- Keep controllers/routes thin and put business rules in facets/services.
- Keep tenant context server-injected through `requireApiKey`/`secureContext`; never trust tenant IDs from request bodies for scoped operations.
- Use Prisma as the single persistent source of truth.
- Keep provider and chain integrations behind interfaces/adapters.
- Keep raw API keys one-time only; store hashes and show prefix/metadata after creation.
- Use transactional audit writes for privileged state changes.

### Current Backend Gaps

`TenantManagementFacet` and routes are admin-key oriented, not platform-admin oriented.

- `TenantManagementFacet.listTenants` can list all tenants when the caller has API role `ADMIN`.
- `tenantRoutes.ts` uses `requireApiKey`, `tenantRateLimiter`, `requireAdmin`, but does not distinguish Quantum Platform Admin from tenant API admin.
- `ApiKeyController.generate` accepts `tenantId` in the body and does not enforce a true Platform Admin boundary.
- OpenAPI mentions idempotency headers on tenant/API-key mutations, but routes do not apply `requireIdempotency`.
- `AuditLog` lacks canonical actor, reason, diff/payload hash, correlation id and admin query ergonomics.

### Recommended Backend Models

The exact names can be adjusted during planning, but the plan should include equivalent structures.

Tenant/commercial:

- `Tenant.status`: `DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`
- `activatedAt`, `suspendedAt`, `archivedAt`, `statusReason`
- `TenantCommercialProfile`: legal name, CNPJ/tax id, billing owner, contacts, plan, limits, commercial metadata
- optional `TenantWhiteLabelSettings`

Human identity and admin membership:

- `TenantUser` or `BackendUser`
- `ExternalIdentity`: dashboard legacy id, `openId`, email auth, future auth providers
- `TenantMembership`: tenant role, platform role, status
- `GuardianDependentRelation` or equivalent relationship model
- legacy fields: `legacyDashboardUserId`, `legacyOpenId`, migration timestamps

Admin/security/audit:

- `AdminAuditLog` or expanded `AuditLog` with `actorUserId`, `actorTenantId`, `action`, `reason`, `payloadHash`, `resourceType`, `resourceId`, `correlationId`, `ipAddress`, `userAgent`
- `ApiRequestAudit`: `tenantId`, `apiKeyId`, `keyPrefix`, `method`, `path`, `selector`, `statusCode`, `latencyMs`, `correlationId`, `sanitizedError`

API keys:

- `scopes String[]`
- `createdByActorId`
- `revokedByActorId`
- `revocationReason`
- `rotatedFromApiKeyId`
- `lastRotatedAt`
- optional owner/label metadata for operational ownership

Commercial:

- `PurchaseOrder`
- `PaymentIntent`
- `PaymentEvent`
- `PaymentProvider` or `ReceivablesProvider` interface
- `CreditLedgerEntry`
- optional `TenantCreditAccount` as derived balance snapshot

QTAG:

- `QTagLedgerEntry`
- `QTagFulfillmentOrder`
- `EncodingSession.fulfillmentOrderId`
- `EncodingSession.attemptNo`
- `EncodingSession.stationId`
- `EncodingSession.operatorId`
- `EncodingSession.expiresAt`
- `EncodingSession.lastError`
- relax/remove current `EncodingSession.assetId @unique` if retries for the same asset are required
- `Device.status` beyond boolean `isActive`, for example `PROVISIONED`, `ACTIVE`, `DISABLED`, `REPLACED`

## Dashboard Architecture Findings

`qc-dashboard` has enough infrastructure for the admin module, but the current admin model is too coarse.

Reusable patterns:

- tRPC router in `server/routers.ts`
- `createContext` with `user` and `qcClient`
- `adminProcedure` in `server/_core/trpc.ts`
- `wouter` routing
- `DashboardLayout`
- UI components: table, tabs, card, dialog, sheet, badge, form, select, empty states
- server tests using `appRouter.createCaller`, `makeTrpcContext`, `makeMockQcClient`

Missing:

- no active `/admin/platform`
- no active `/admin/tenant`
- no admin module shell
- no tenant membership/platform admin distinction
- dashboard schema only has local `users` and `ui_preferences`
- current store/cart flow credits directly and simulates checkout

Planning implication:

- Add a dedicated `admin` namespace to `appRouter`.
- Keep Platform Admin and Tenant Admin guards separate.
- Dashboard should call backend admin contracts through explicit `QCBackendClient.admin.*` methods.
- Every dashboard admin mutation must send actor/reason/correlation metadata to backend.
- Do not use the old `backup_old` admin UI as a source of truth.

Suggested tRPC shape:

- `admin.platform.tenants.list`
- `admin.platform.tenants.create`
- `admin.platform.tenants.activate`
- `admin.platform.tenants.suspend`
- `admin.platform.apiKeys.createInitial`
- `admin.platform.apiKeys.rotate`
- `admin.platform.apiKeys.revoke`
- `admin.platform.credits.grant`
- `admin.platform.credits.adjust`
- `admin.platform.qtags.fulfillmentQueue`
- `admin.platform.audit.byTenant`
- `admin.tenant.summary`
- `admin.tenant.apiKeys.list`
- `admin.tenant.credits.summary`
- `admin.tenant.qtags.summary`

## Credits, Receivables and Provider Boundary

Current `WalletService` is not the Phase 4 credit model.

Current behavior:

- `UserWallet` represents custodial/generated blockchain deposit addresses by tenant.
- `Deposit` records stablecoin deposits.
- `WalletService.getBalance` derives financial balance from deposits and chain transactions.
- `qc-dashboard` has a tested local rule that credit purchases change `creditsBalance`, not `balance`.

Phase 4 decision:

- credits are application usage credits;
- ledger is source of truth;
- client wallet is not custodied by Quantum Cert for commercial flow;
- Transfero is a preferred candidate provider, but final contract remains TBD with `qc-business`.

Planning implication:

- Do not extend `UserWallet` as the credit ledger.
- Create `CreditLedgerEntry` with immutable entries.
- Use derived/projection balance from ledger.
- For credit use, implement `RESERVED` then `CONSUMED` or `RELEASED`.
- For admin grants/adjustments, require reason and actor.
- For purchases, create `PurchaseOrder` and `PaymentIntent` first; append `CreditLedgerEntry(PURCHASED)` only after confirmed `PaymentEvent`.
- Do not couple Phase 4 to MercadoPago or Transfero-specific payloads. Use generic provider interfaces and adapters.

## QTAG Entitlement and Fulfillment

Current commissioning is Diamond-only and already usable as a technical base.

Current flow:

1. `qc-record-module-node` reads UID and calls `commissioning.start`.
2. `CommissioningFacet.start` signs metadata, creates `EventLog`, generates SDM keys and creates `EncodingSession(IN_PROGRESS)`.
3. The writer physically writes the tag and calls `commissioning.confirm`.
4. `confirm` marks the session `COMPLETED`/`FAILED` and upserts `Device`.
5. `/api/v1/scan` validates SDM and tries to resolve the asset through `Device`.

Critical gaps:

- `confirm` upserts `Device` but does not update `Asset.deviceId`.
- `EncodingSession.assetId @unique` blocks clean retry for same asset after failure.
- `commissioning.start` is not tied to a fulfillment order or reserved entitlement.
- `confirm` should validate UID, session, bytes written, tenant, order status and entitlement state.
- `device.upsert({ where: uid })` can be risky without tenant/status constraints.
- `commissioning.start` generates `sdmEncKey`, but the writer may need complete one-time material; the contract must be explicit.
- there are multiple device paths (`DeviceRegistryFacet`, `DeviceGuardFacet`, `CommissioningFacet.confirm`) that need one canonical Phase 4 activation path.

Recommended QTAG flow:

1. Purchase/provider confirmation appends `QTagLedgerEntry(PURCHASED)`.
2. User selects an existing `Asset`.
3. Backend verifies asset ownership and QTAG availability.
4. Backend appends `QTagLedgerEntry(RESERVED)` and creates `QTagFulfillmentOrder`.
5. Operator/encoder claims the fulfillment order.
6. `commissioning.start` receives or derives `fulfillmentOrderId`.
7. Encoding creates an `EncodingSession` attempt.
8. `commissioning.confirm(success=true)` validates all invariants, updates `Device`, links `Asset.deviceId`, marks order `ACTIVATED`, appends `QTagLedgerEntry(CONSUMED)`.
9. Failure before activation marks attempt/order state and can release or retry without losing entitlement.

Recommended statuses:

- `QTagLedgerEntry`: `PURCHASED`, `GRANTED`, `RESERVED`, `CONSUMED`, `RELEASED`, `REFUNDED`, `ADJUSTED`, `REVOKED`
- `QTagFulfillmentOrder`: `REQUESTED`, `READY_FOR_ENCODING`, `ENCODING_IN_PROGRESS`, `ENCODING_FAILED`, `QA_PENDING`, `QA_FAILED`, `DISPATCH_READY`, `DISPATCHED`, `DELIVERED`, `ACTIVATED`, `CANCELLED`, `EXPIRED`

## Backfill Research

The active backend schema has `Tenant`, `Asset`, `Owner`, `UserWallet` and `ApiKey`, but not a canonical user model.

Observed local snapshot from subagent read-only inspection:

- `qc-dashboard`: 219 users, 148 primary users, 71 dependents, 61 with CPF, 2 admins, 0 orphan dependents, 52 with `identityAssetId`.
- `qc-backend`: 6 tenants, 4 assets, 1 owner, 1 `UserWallet`, 1 deposit, 4 API keys, 3 `EncodingSession` records.

Data to migrate:

- dashboard `users`: id, `openId`, email, phone, CPF, `passwordHash`, role, timestamps, `guardianId`, medical/emergency metadata
- dependents/guardian graph
- profile identity assets and `metadata.identityAssetId`
- `Asset` ownership references through `Owner.ownerRef`
- any available durable credit source
- existing `EncodingSession`/`Device` records into the new QTAG model where possible

Blockers:

- no backend `TenantUser` model yet;
- dashboard credit balances appear local/fallback rather than durable backend ledger;
- `Owner.ownerRef` is loose string data and may not match dashboard `openId` or CPF;
- Phase 4/5 artifact conflict must be resolved before execution plans.

Recommended migration engine:

- same engine for `dryRun` and `execute`;
- stable batches by dashboard user id;
- upsert by `legacyDashboardUserId`, `legacyOpenId`, and natural keys;
- `MigrationRun` records with mode, batch, checksum, counts, errors and status;
- no deletion from dashboard during migration;
- post-validation report for counts, duplicate CPF/email/openId, orphan dependents, unresolved ownerRefs, assets without canonical owner and credit-source gaps.

## Security Threat Model Seeds

Planner must include a `<threat_model>` block in each plan. Initial threats:

- platform admin vs tenant admin confusion exposes cross-tenant data;
- tenant API `ADMIN` key can create/manage other tenants if platform guard is not explicit;
- API key generation trusts `tenantId` body without platform authorization;
- admin UI hides navigation but server routes still allow unauthorized calls;
- dashboard service account masks the real human actor unless actor metadata is required;
- API request audit logs accidentally persist raw API keys or sensitive payloads;
- payment provider webhooks are replayed, forged or processed twice;
- credit/QTAG ledger balance is derived from mutable counters instead of immutable entries;
- QTAG fulfillment retries consume entitlement twice or release entitlement after activation;
- `commissioning.confirm` activates wrong UID or cross-tenant device;
- backfill maps users/assets to wrong tenant or wrong owner;
- migration is non-idempotent and duplicates users/assets/ledger entries.

## Recommended Plan Slices

Because `ROADMAP.md` marks Phase 4 as MVP mode, planning should prefer vertical operational slices. However, this phase also requires schema foundations. The first plan should be an explicit alignment/foundation slice that makes the rest possible.

Suggested slices:

1. **Scope alignment and canonical data foundation**
   - Update/align Phase 4/5 artifacts or record the new boundary.
   - Add canonical user/membership models required for Platform Admin, Tenant Admin and backfill.
   - Add migration run/checkpoint models.

2. **Platform admin tenant lifecycle**
   - Tenant commercial profile, status workflow, activation/suspension/archive, audit.
   - Backend admin routes/selectors plus dashboard tenant list/detail hub skeleton.

3. **API keys and request audit**
   - Initial key issuance by Quantum, active key list, rotation/revocation, scopes, request audit.
   - Dashboard panels and tests for platform-only actions.

4. **Credits and receivables foundation**
   - Purchase order/payment intent/event provider boundary.
   - Credit ledger with reserve/consume/release/grant/adjust.
   - Admin operations panel.

5. **QTAG entitlement and fulfillment**
   - QTAG ledger, fulfillment order, reservation/release/consume.
   - Backend queue and dashboard operational queue.
   - Commissioning integration fixes.

6. **Backfill execution**
   - Tenant Quantum creation/validation.
   - Migration dry-run report.
   - Execution with idempotent checkpoints and validation report.

7. **Tenant admin constrained view and cross-repo UAT**
   - `/admin/tenant` view scoped to own tenant.
   - Cross-repo tests proving Platform Admin cross-tenant and Tenant Admin own-tenant behavior.

## Validation Architecture

### Test Infrastructure

| Repo | Framework | Quick command | Full command |
|------|-----------|---------------|--------------|
| `qc-backend` | Vitest | `npm test -- --run tests/<target>.test.ts` | `npm test -- --run` |
| `qc-dashboard` | Vitest + TypeScript | `pnpm test -- <target>` | `pnpm test && pnpm check` |

### Backend Automated Coverage Needed

- Prisma schema generation after model changes: `npm run db:generate`
- schema push/migration task after schema changes: `npm run db:push`
- tenant lifecycle facet/controller tests;
- platform vs tenant admin authorization tests;
- API key initial issue/list/rotate/revoke tests;
- API request audit middleware tests proving no raw key/body persistence;
- credit ledger reserve/consume/release/grant/adjust tests;
- payment event idempotency/deduplication tests;
- QTAG ledger and fulfillment transition tests;
- commissioning confirm tests for UID/session/tenant/bytes/order and `Asset.deviceId` update;
- migration dry-run and execution idempotency tests.

### Dashboard Automated Coverage Needed

- admin route guard tests for `adminProcedure` and new tenant/platform guards;
- tRPC tests for platform admin tenant/API-key/credit/QTAG procedures;
- UI smoke tests for `/admin/platform`, tenant detail tabs and operational queues;
- tests ensuring tenant admin cannot read other tenant data;
- tests replacing direct `wallet.purchaseCredits` credit mutation with purchase/payment intent flow once backend contracts exist.

### Manual/UAT Coverage Needed

- Platform Admin creates and activates a tenant, issues first API key, rotates/revokes it and sees request audit.
- Platform Admin grants credits with reason and sees ledger/audit.
- Tenant Admin only sees own tenant data.
- QTAG purchase creates available entitlement; selecting Asset reserves unit; encoding/commissioning activates device and links Asset; failure before activation releases or retries correctly.
- Backfill dry-run and execution reports are reviewed before dashboard cutover.

## Planning Risks

- Proceeding to plan without UI-SPEC will produce under-specified admin UI work.
- Proceeding to implementation without Phase 4/5 artifact alignment will duplicate or contradict backfill acceptance criteria.
- Planning by old migrations instead of active Prisma schema will introduce dead models.
- Treating `UserWallet` as credits will violate the wallet/custody decision.
- Treating `ApiKeyRole.ADMIN` as Platform Admin will create cross-tenant security issues.
- Treating `commissioning.confirm` as activation without linking `Asset.deviceId` will break public scan resolution.

## Research Complete

Research is sufficient for planning after the UI design contract is generated. The next workflow gate should require `04-UI-SPEC.md` because Phase 4 contains substantial admin interface work in `qc-dashboard`.
