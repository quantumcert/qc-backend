# Phase 4: B2B Admin Operations Console — Specification

**Status:** Approved for planning
**Created:** 2026-05-17
**Repos:** `qc-dashboard`, `qc-backend`; business rules in `qc-business`
**Placement decision:** deliver inside `qc-dashboard` as an isolated admin module first; extract to `qc-admin` only when deployment, auth, branding, compliance, or team ownership require a separate app.

## Goal

Create the operational admin surface Quantum Cert needs before on-chain asset rollout. Platform admins must be able to register and manage B2B clients/companies, activate tenants, create API keys, manage purchases/receivables, grant credits, operate QTAG fulfillment, operate the commercial lifecycle from one controlled interface, and execute the Tenant Quantum/user backfill needed to make backend identity canonical.

The user decision on 2026-05-17 moved Tenant Quantum, complete B2C user backfill and B2C dashboard cutover into this phase. Phase 5 is therefore reserved for B2B tenant external readiness after Phase 4 creates the canonical backend identity, migration engine and B2C execution report.

## Current Problem

The platform has backend tenant/API-key primitives and `qc-dashboard` has an admin role concept, but there is no complete operational cockpit for B2B administration. Without it, B2B tenants would need manual database edits or ad hoc scripts for onboarding, activation, credits, purchases, and API access.

That creates operational risk:

1. B2B customers can be created without a consistent activation/commercial state.
1a. B2B customers can be duplicated under different tenants if CNPJ/taxId is not treated as a canonical unique key.
2. API keys may be provisioned without a review, owner, expiration, rotation, or audit trail.
3. Purchases and credit grants can drift from the tenant record and later break identity/backfill/on-chain phases.
4. Platform admin and tenant admin responsibilities remain mixed.
5. Wallet/credit terminology can drift into direct client-wallet custody, which must be avoided for the production commercial model.
6. QTAG purchases can drift into physical fulfillment without an Asset selection, making tags impossible to trace back to the protected asset.
7. B2C users remain split between the dashboard database and backend assets, blocking a single operational view for Tenant Quantum.
8. Users/operators of each tenant can remain invisible to Platform Admin or be managed outside the canonical backend model, breaking auditability, ownership resolution and the future on-chain Asset view.

## Product Boundary

Use `qc-dashboard` for the first version because it already owns the authenticated operational experience and can reuse the existing route/auth/tRPC patterns. The module must still be architected as a separable admin app boundary:

```text
qc-dashboard
  /admin/platform  -> Quantum platform admins
  /admin/tenant    -> B2B tenant admins
  /app             -> regular B2C/B2B user workflows
```

The future `qc-admin` extraction becomes justified only if one or more are required:

- separate deployment or release cadence;
- separate internal-only SSO/auth policy;
- stricter audit/compliance boundary;
- different visual identity for Quantum internal operations;
- enough admin surface area that it slows or complicates the normal dashboard.

## Target Model

### Platform Admin

Quantum platform admins can operate across tenants:

- create and edit B2B client/company records;
- set tenant status: draft, pending review, active, suspended, archived;
- define the tenant anchoring chain through `Tenant.targetChain`, with `STELLAR` as the default for new tenants and Tenant Quantum;
- configure legal/commercial profile: company name, CNPJ/tax ID, contacts, billing owner, plan, limits, white-label metadata;
- enforce CNPJ/taxId uniqueness for Tenant B2B creation and profile updates;
- edit tenant profile through the admin UI and keep a canonical tenant-profile `Asset` with an approved anchoring event for every profile creation/update;
- activate/deactivate tenant access;
- create, rotate, revoke and audit API keys;
- approve purchases or commercial orders;
- grant, revoke or adjust tenant credits with mandatory reason;
- inspect receivables/payment status from the configured external provider;
- manage QTAG entitlement balances, issuance queue, engraving/encoding status, dispatch and failed/retry states;
- view tenant usage, asset counts, credit balance, API activity, and operational incidents;
- list, create and edit tenant-scoped users/operators for any tenant, including role, status, contact/profile metadata, external identity links and audit history;
- view each tenant user's profile Asset state when available and the Assets owned by, delegated to or associated with that user;
- impersonation/debug must be explicit, audited, and disabled by default unless planned separately.

### Tenant Admin

B2B tenant admins can operate only their own tenant:

- manage company profile fields allowed by policy;
- view own API keys and request rotation when policy allows;
- manage team users/operators;
- view purchases, credits, usage and invoices/receipts;
- create/import assets where the tenant plan allows it;
- view activation status and required pending actions.

Phase 4 must expose Platform Admin operational CRUD for tenant users. Full Tenant Admin self-service for invitations, removals, operator policy and external B2B readiness remains Phase 5.

### Audit and Security

Every privileged action must be server-authorized and audited. Hidden navigation is not enough.

API key scopes must come from a canonical catalog, be selectable in the admin UI by checkbox, be validated by dashboard/backend schemas, and be enforced against Diamond selectors and scoped REST routes before tenant operations run.

Required audit events:

- tenant created/updated/activated/suspended;
- API key created/rotated/revoked;
- credit grant/revoke/adjustment;
- purchase approved/refunded/cancelled;
- payment/receivable confirmed/failed/reversed;
- QTAG entitlement purchased/reserved/released/consumed;
- QTAG issuance requested/encoded/failed/dispatched/activated;
- plan/limit changed;
- tenant admin invited/removed;
- tenant user created/updated/status-changed/role-changed;
- tenant user profile Asset linked or refreshed;
- white-label settings changed.

## Wallet, Receivables and Credit Model

The production model must separate three concepts:

1. **Client wallet**: the customer's own blockchain or financial wallet. Quantum Cert must not directly custody this wallet in the commercial flow.
2. **Receivables/payment account**: the external payment/anchor path used to receive money or stablecoins for purchases. Transfero is the preferred candidate to research first, but the final implementation is still to be defined.
3. **Application credits**: internal usage credits used to register assets, activate certification, trigger on-chain registration, issue/link QTAGs, consume API packages, or other product actions.

Credits are not a token balance and must not be derived from wallet balance. They are represented by a backend ledger.

Target flow for buying credits:

```text
Tenant/User selects credit package
  -> backend creates PurchaseOrder / PaymentIntent
  -> external provider/anchor handles payment or receivable
  -> provider webhook/callback confirms payment
  -> backend records PaymentEvent
  -> backend appends CreditLedgerEntry(PURCHASED)
  -> available credits increase
```

Target flow for using credits:

```text
Asset/certification/API action requested
  -> backend checks available credits and tenant limits
  -> backend performs idempotent reservation or debit
  -> action succeeds
  -> backend appends CreditLedgerEntry(CONSUMED)
```

Manual admin credit changes must use the same ledger with types such as `GRANTED`, `REVOKED`, `ADJUSTED`, `REFUNDED`, `EXPIRED`, and must include actor, reason, tenant/user scope, reference object, and audit event.

**Provider decision:** implement the receivables path behind a `PaymentProvider`/`ReceivablesProvider` interface. Transfero should be documented as the first candidate anchor/provider, but Phase 4 planning must leave the concrete integration contract, settlement model, supported currencies, webhook security and compliance flow as implementation details to confirm with `qc-business`.

## QTAG Entitlement and Fulfillment Model

Physical QTAGs must be treated as their own entitlement balance, separate from application credits.

Target flow for buying QTAGs:

```text
Tenant/User selects physical QTAG package
  -> backend creates PurchaseOrder / PaymentIntent
  -> external provider confirms payment
  -> backend appends QTagLedgerEntry(PURCHASED)
  -> availableQTags increases
```

Target flow for using a QTAG:

```text
Tenant/User selects existing Asset
  -> backend verifies Asset ownership and eligibility
  -> backend reserves or consumes 1 available QTAG entitlement
  -> backend creates QTagFulfillmentOrder(assetId, tenantId/userId)
  -> admin queue receives issuance job
  -> qc-record-module/encoding station writes the physical tag
  -> commissioning.confirm(success=true) activates the Device/QTAG
  -> shipping/tracking is recorded
```

Rules:

- A QTAG can never be active without being linked to exactly one protected Asset.
- Buying a QTAG does not activate the chip and does not create final physical linkage.
- Selecting an Asset for QTAG issuance removes that unit from `availableQTags` by reservation/consumption; if issuance is cancelled or fails before physical activation, the unit can be released back through an auditable ledger entry.
- The fulfillment order is the bridge between commercial purchase, Asset selection, physical engraving/encoding, dispatch and eventual QTAG activation.
- Activation must happen only after physical write/commissioning confirmation, not at purchase time.
- The admin console must expose the operational queue for pending issuance, in progress encoding, failed write/retry, QA, dispatched, delivered/active and cancelled orders.

## Required Backend Surfaces

The planning phase must define API contracts for:

- platform admin tenant CRUD;
- tenant activation workflow;
- tenant plan/limit/commercial profile management;
- tenant target-chain selection and persistence, defaulting to `STELLAR` and feeding the same `AnchorQueueService` routing used by normal assets;
- tenant profile Asset upsert and anchoring event generation, using the visible Tenant name as the public `externalId`, preserving lookup/migration from legacy `tenant-profile:<tenantId>` records, `targetChain` metadata, deterministic CNPJ/taxId key metadata and the same `EventLog`/anchor queue used by normal assets;
- API key lifecycle with multiple active keys per tenant, prefix display, hashed secret storage, expiration, rotation and revocation;
- canonical API key scope catalog with selector/route mapping and role-based defaults for Reader, Operator and Admin keys;
- purchase/order records or integration placeholders;
- payment intent and payment event records;
- receivables provider adapter boundary, with Transfero as candidate implementation to define;
- credit ledger for B2B tenant credits;
- QTAG entitlement ledger and available balance;
- QTAG fulfillment/order records linked to a target `Asset`;
- QTAG issuance queue statuses for engraving/encoding, QA, dispatch, delivery/activation and failure/retry;
- credit grant/revoke/adjustment with reason and actor;
- platform admin tenant-user list/detail/create/update/status/role operations;
- tenant-user profile Asset visibility and associated Asset list by ownership/delegation;
- external identity link/unlink contracts for tenant users, with conflict reporting instead of silent merge;
- transfer/ownership lookup contracts that resolve sender and recipient to canonical tenant users/profile Assets when possible, using normalized/hashed CPF/document and preserving pending recipients instead of creating tenants;
- audit log query by tenant and by actor;
- tenant-admin self-service views constrained to current tenant.

## Required Dashboard Surfaces

Minimum `qc-dashboard` admin UI:

- admin shell separated from normal user navigation;
- tenant/company list with status filters;
- create/edit company form with editable slug suggested from the typed company name;
- tenant detail page with status, plan, limits, usage, credits, API keys, purchases and audit timeline;
- editable tenant profile panel showing the canonical profile Asset/external id/public URL state;
- QTAG balance panel showing available, reserved/in fulfillment, active/dispatched and failed/cancelled quantities;
- activation review/action panel;
- API key management panel with create, rotate and revoke flows;
- API key creation form with explicit scope checkboxes, not free-text scope entry;
- purchase/receivables/credit operations panel with payment status and reason fields;
- QTAG fulfillment queue with asset, owner, order, status, encoder/operator, dispatch tracking and retry actions;
- tenant detail Team/Usuários tab for Platform Admin with user list, create/edit user dialog, role/status controls, external identity metadata, profile Asset state and owned/associated Assets;
- constrained tenant admin user/team panel for own-tenant visibility, with full self-service invite/operator lifecycle deferred to Phase 5;
- safe empty/loading/error states for operational work.

## Data Model Requirements

Add or confirm canonical backend storage for:

- tenant commercial profile;
- tenant target chain through `Tenant.targetChain`, with `STELLAR` as default and supported multichain values validated by backend/admin schemas;
- canonical tenant CNPJ/taxId uniqueness, including backend validation and database constraint on normalized taxId;
- canonical tenant profile Asset with public `externalId` equal to the visible Tenant name, profile metadata, CNPJ/taxId key metadata, legacy `tenant-profile:<tenantId>` fallback and approved event log for blockchain anchoring;
- tenant activation status and activation timestamps;
- API key metadata, hashed secret, prefix, scopes, expiration and revoked metadata;
- selector/route-to-scope policy used at runtime to reject unmapped or unauthorized API-key calls;
- tenant plan/limit fields;
- purchase orders/payment intents;
- payment events/provider callbacks;
- B2B credit ledger entries;
- QTAG ledger entries for purchased, reserved, consumed, released, refunded and adjusted units;
- QTAG fulfillment order with tenant/user/asset references, status, selected asset, optional product SKU, shipping recipient and tracking metadata;
- link from fulfillment order to `EncodingSession`/`Device` once physical commissioning starts;
- purchase/order records or integration reference IDs;
- admin audit log entries tied to actor, tenant, action and payload hash;
- tenant user records, external identity links, membership role/status assignments and profile Asset reference/status.
- Tenant Quantum canonical record for B2C users;
- backend tenant-scoped user, external identity and membership records;
- migration run/checkpoint/report records for idempotent dashboard backfill;
- strong optional link from `Owner.ownerRef` to a backend tenant user while preserving legacy references;
- transfer records/events mapped to canonical `TenantUser` and profile Asset references when a sender/recipient is known, plus document hash for pending recipients;
- migrated credit/QTAG state needed for B2C operational continuity.

## Acceptance Criteria

1. A Quantum platform admin can create a B2B client/company from the admin area without direct DB access.
2. A created B2B client becomes a backend `Tenant` with status, commercial profile, limits, target chain and activation state. If no chain is selected, the backend persists `STELLAR`.
2a. Tenant CNPJ/taxId is unique across tenants; duplicate creation/update is rejected before creating a second tenant record.
2b. Every tenant profile create/update creates or updates a canonical profile `Asset` and appends an approved `EventLog` with `signatureHash`, `targetChain` context and deterministic CNPJ/taxId key metadata so the same profile mutation is visible to the application and anchor queue.
3. A platform admin can create multiple API keys, rotate and revoke them, and only key prefix/metadata are visible after creation. API keys authenticate only while the tenant is `ACTIVE`; suspension blocks usage without automatic revocation. Creation uses checkbox-selected canonical scopes; invalid scopes are rejected and Diamond/REST calls are denied when the key lacks the required scope.
4. A platform admin can grant or adjust credits with a mandatory reason and auditable ledger entry.
5. Purchases/activation/receivable records are visible on the tenant detail page and are linked to the tenant.
6. Tenant admins can view only their own tenant operational data.
7. Every privileged mutation is protected by server-side authorization and creates an audit event.
8. A credit purchase creates a purchase/payment record first and only increases credits after confirmed payment/provider event.
9. The implementation does not require Quantum Cert to custody the customer's wallet directly.
10. A QTAG purchase increases available QTAG balance and does not activate any physical tag.
11. Assigning a QTAG to an Asset reserves/consumes one available unit and creates an operational fulfillment order linked to that Asset.
12. The admin queue allows operators to process engraving/encoding, retry failures, record dispatch/tracking and see pending work.
13. The physical tag becomes active only after successful commissioning confirmation, and a failed/cancelled order can release the reserved unit through the QTAG ledger.
14. Tenant Quantum exists as canonical backend tenant for B2C users.
15. Existing `qc-dashboard.users` B2C users/dependents are migrated into backend tenant-scoped users with idempotent dry-run and execution reports.
16. B2C dashboard domain writes for users, dependents, credits and asset ownership are cut over to backend canonical contracts; the local dashboard database remains only for session/preferences compatibility.
17. Existing B2C ownership references that match `openId` or migrated aliases are resolvable to canonical backend users while preserving `Owner.ownerRef`.
18. Existing B2C credit/QTAG state required for continuity is represented in backend ledgers without changing the locked rule that registration flows alter credits, not wallet balance.
19. Platform Admin can list, create and edit users for any tenant from the tenant detail Team/Usuários tab, see their role/status/external identity, profile Asset state and owned/associated Assets, and every mutation is tenant-scoped and audited.
20. B2C transfer flows resolve sender/recipient as `TenantUser` + profile Asset under Tenant Quantum when available; unknown CPF recipients remain pending user/profile links and never become tenants.
21. This phase produces the tenant/API-key/credit/QTAG/backfill/user-admin foundation required for Phase 5 B2B external readiness.

## Out of Scope

- Building a separate `qc-admin` app in this phase.
- Full invoicing/accounting integration.
- Public self-service B2B signup without platform review.
- Final white-label public verification UI.
- Generalized on-chain asset identity/provenance for every entity type; tenant profile Asset anchoring is in scope here as the operational bridge for Phase 4.
- Full Tenant Admin self-service invitation/operator lifecycle for external B2B customers; Phase 4 includes Platform Admin operational user CRUD and constrained own-tenant visibility, while Phase 5 expands tenant-managed B2B operations.
- Final Transfero/provider integration contract; this remains implementation to define during planning with `qc-business`.
