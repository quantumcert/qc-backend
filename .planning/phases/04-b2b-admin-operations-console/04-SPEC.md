# Phase 4: B2B Admin Operations Console — Specification

**Status:** Approved for planning
**Created:** 2026-05-17
**Repos:** `qc-dashboard`, `qc-backend`; business rules in `qc-business`
**Placement decision:** deliver inside `qc-dashboard` as an isolated admin module first; extract to `qc-admin` only when deployment, auth, branding, compliance, or team ownership require a separate app.

## Goal

Create the operational admin surface Quantum Cert needs before tenant identity migration and on-chain asset rollout. Platform admins must be able to register and manage B2B clients/companies, activate tenants, create API keys, manage purchases/receivables, grant credits, and operate the commercial lifecycle from one controlled interface.

This phase must come before the unified identity/backfill phase because B2B tenants, API keys, activation state, credit grants, purchase records, receivables and commercial terms need to exist before users/assets are migrated onto the canonical backend model.

## Current Problem

The platform has backend tenant/API-key primitives and `qc-dashboard` has an admin role concept, but there is no complete operational cockpit for B2B administration. Without it, B2B tenants would need manual database edits or ad hoc scripts for onboarding, activation, credits, purchases, and API access.

That creates operational risk:

1. B2B customers can be created without a consistent activation/commercial state.
2. API keys may be provisioned without a review, owner, expiration, rotation, or audit trail.
3. Purchases and credit grants can drift from the tenant record and later break identity/backfill/on-chain phases.
4. Platform admin and tenant admin responsibilities remain mixed.
5. Wallet/credit terminology can drift into direct client-wallet custody, which must be avoided for the production commercial model.

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
- configure legal/commercial profile: company name, CNPJ/tax ID, contacts, billing owner, plan, limits, white-label metadata;
- activate/deactivate tenant access;
- create, rotate, revoke and audit API keys;
- approve purchases or commercial orders;
- grant, revoke or adjust tenant credits with mandatory reason;
- inspect receivables/payment status from the configured external provider;
- view tenant usage, asset counts, credit balance, API activity, and operational incidents;
- impersonation/debug must be explicit, audited, and disabled by default unless planned separately.

### Tenant Admin

B2B tenant admins can operate only their own tenant:

- manage company profile fields allowed by policy;
- view own API keys and request rotation when policy allows;
- manage team users/operators;
- view purchases, credits, usage and invoices/receipts;
- create/import assets where the tenant plan allows it;
- view activation status and required pending actions.

### Audit and Security

Every privileged action must be server-authorized and audited. Hidden navigation is not enough.

Required audit events:

- tenant created/updated/activated/suspended;
- API key created/rotated/revoked;
- credit grant/revoke/adjustment;
- purchase approved/refunded/cancelled;
- payment/receivable confirmed/failed/reversed;
- plan/limit changed;
- tenant admin invited/removed;
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

## Required Backend Surfaces

The planning phase must define API contracts for:

- platform admin tenant CRUD;
- tenant activation workflow;
- tenant plan/limit/commercial profile management;
- API key lifecycle with prefix display, hashed secret storage, expiration, rotation and revocation;
- purchase/order records or integration placeholders;
- payment intent and payment event records;
- receivables provider adapter boundary, with Transfero as candidate implementation to define;
- credit ledger for B2B tenant credits;
- credit grant/revoke/adjustment with reason and actor;
- audit log query by tenant and by actor;
- tenant-admin self-service views constrained to current tenant.

## Required Dashboard Surfaces

Minimum `qc-dashboard` admin UI:

- admin shell separated from normal user navigation;
- tenant/company list with status filters;
- create/edit company form;
- tenant detail page with status, plan, limits, usage, credits, API keys, purchases and audit timeline;
- activation review/action panel;
- API key management panel with create, rotate and revoke flows;
- purchase/receivables/credit operations panel with payment status and reason fields;
- tenant admin user/team panel;
- safe empty/loading/error states for operational work.

## Data Model Requirements

Add or confirm canonical backend storage for:

- tenant commercial profile;
- tenant activation status and activation timestamps;
- API key metadata, hashed secret, prefix, scopes, expiration and revoked metadata;
- tenant plan/limit fields;
- purchase orders/payment intents;
- payment events/provider callbacks;
- B2B credit ledger entries;
- purchase/order records or integration reference IDs;
- admin audit log entries tied to actor, tenant, action and payload hash;
- tenant admin membership and role assignments.

## Acceptance Criteria

1. A Quantum platform admin can create a B2B client/company from the admin area without direct DB access.
2. A created B2B client becomes a backend `Tenant` with status, commercial profile, limits and activation state.
3. A platform admin can create, rotate and revoke API keys, and only key prefix/metadata are visible after creation.
4. A platform admin can grant or adjust credits with a mandatory reason and auditable ledger entry.
5. Purchases/activation/receivable records are visible on the tenant detail page and are linked to the tenant.
6. Tenant admins can view only their own tenant operational data.
7. Every privileged mutation is protected by server-side authorization and creates an audit event.
8. A credit purchase creates a purchase/payment record first and only increases credits after confirmed payment/provider event.
9. The implementation does not require Quantum Cert to custody the customer's wallet directly.
10. This phase produces the tenant/API-key/credit foundation required by Phase 5 identity/backfill.

## Out of Scope

- Building a separate `qc-admin` app in this phase.
- Full invoicing/accounting integration.
- Public self-service B2B signup without platform review.
- Final white-label public verification UI.
- On-chain asset identity/provenance.
- Final Transfero/provider integration contract; this remains implementation to define during planning with `qc-business`.
