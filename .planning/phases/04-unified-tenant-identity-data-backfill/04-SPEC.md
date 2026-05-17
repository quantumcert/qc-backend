# Phase 4: Unified Tenant Identity + Data Backfill — Specification

**Status:** Approved for planning
**Created:** 2026-05-17
**Repos:** `qc-backend`, `qc-dashboard`; later consumers: `qc-home`, `qc-record-module`
**Business source of truth:** `qc-business`

## Goal

Make `qc-backend` the canonical source of truth for tenants, users, dependents, wallets/credits, and asset ownership. The current B2C users from `qc-dashboard` must be migrated under the operational Tenant Quantum. Future B2B customers remain separate tenants with their own admins, operators, API keys, billing rules, and white-label surfaces.

This phase must complete before deeper on-chain provenance work. The chain cannot become the reliable visibility layer while users and ownership still live in two separate databases.

## Current Problem

`qc-backend` has strong tenant and asset primitives, but the active schema does not expose a canonical user model. `qc-dashboard` keeps `users`, dependents, local auth fields, role, CPF, emergency/medical metadata, and local credit fallback. Assets are already mostly delegated to `qc-backend`, but identity and ownership are bridged through `ownerRef`/`openId` rather than a strong backend user reference.

This creates three risks:

1. B2C users cannot be cleanly attached to Tenant Quantum in the backend.
2. B2B tenant users and Quantum platform admins would compete for the same loose role model.
3. Backfill to on-chain assets would anchor unstable ownership references.

## Target Model

- `Tenant Quantum` is a real tenant, for example slug `quantum`.
- B2C users are tenant-scoped users under Tenant Quantum, not tenants.
- B2B customers are real tenants with their own tenant users, tenant admins, operators, API keys, limits, billing rules, and branded public verification.
- Platform admins belong to Quantum/platform scope and can operate across tenants through explicit platform-admin authorization.
- Tenant admins operate only their own tenant.
- Public verification remains unauthenticated and resolves public identifiers without exposing private tenant/user data.

## Data Model Requirements

Add canonical backend models or equivalent fields for:

- tenant-scoped user/account identity;
- external auth identities such as `openId`, email/password, future magic link/social auth;
- role membership scoped to tenant and/or platform;
- guardian/dependent relationships;
- user profile and private metadata;
- user wallet/credits or account balance surface;
- strong ownership link between `Owner` and tenant user while preserving legacy `ownerRef`;
- backfill mapping fields such as `legacyDashboardUserId`, `legacyOpenId`, and migration timestamps.

The exact table names are implementation details, but the design must preserve the core distinction:

```text
Tenant
  -> TenantUser
      -> Dependents / guardian relationships
      -> Wallet/Credits
      -> Asset ownership
  -> Assets
  -> API keys / agents / webhooks
```

## Backfill Requirements

The backfill must be idempotent and report conflicts before cutover. It must not delete dashboard records until the backend migration has been validated.

Required order:

1. Create or validate Tenant Quantum.
2. Scan `qc-dashboard.users` in stable batches.
3. Upsert each dashboard user into backend tenant-scoped users.
4. Preserve `legacyDashboardUserId`, `legacyOpenId`, CPF/email, role, `guardianId`, medical/emergency fields, and metadata.
5. Rebuild dependent relationships after both guardian and dependent records exist.
6. Create or reconcile each profile/dependent identity Asset.
7. Resolve `Owner.ownerRef` to canonical backend user IDs when ownerRef matches `openId` or migrated aliases.
8. Migrate wallet/credit state so credit consumption happens in backend, preserving the locked business rule: only `creditsBalance` changes for registration credit flows.
9. Produce a report with migrated counts, skipped rows, duplicate CPF/email/openId conflicts, orphan dependents, ownerRefs unresolved, and assets without canonical owner.

## Dashboard Cutover

`qc-dashboard` must stop treating its Drizzle `users` table as the canonical user/domain store. During transition it may keep session state and UI preferences, but authenticated domain data must come from backend endpoints.

Minimum backend surfaces required before dashboard cutover:

- `auth.login` or equivalent session exchange;
- `auth.me`;
- `users.updateProfile`;
- `users.registerDependent`;
- `users.getDependents`;
- `wallet.get`;
- `wallet.purchaseCredits` or payment/credit intent equivalent;
- `assets.create/list/get/update`;
- admin-only user/asset queues for Quantum platform admins.

## Acceptance Criteria

1. A migrated B2C user logs into `qc-dashboard` and resolves to a backend tenant-scoped user under Tenant Quantum.
2. The user's profile and dependents appear as identity assets from backend canonical data.
3. Creating a new asset attaches ownership to the backend user and still preserves public verification.
4. Existing assets whose owners were `ownerRef = openId` are resolvable to canonical users.
5. Credit purchase and registration consumption use backend state and preserve the credit-only rule.
6. Platform admin and tenant admin checks are enforced server-side, not only by hidden UI.
7. The migration report has zero blocking orphan records or documents the explicit remediation list.

## Out of Scope

- Final commercial packaging and pricing.
- Final public signup method choice.
- Full white-label UI implementation.
- On-chain Asset registry implementation; this is Phase 5 and depends on the stable user/ownership model from this phase.
