# Phase 4: B2B Admin Operations Console — Specification

**Status:** Approved for planning
**Created:** 2026-05-17
**Repos:** `qc-dashboard`, `qc-backend`; business rules in `qc-business`
**Placement decision:** deliver inside `qc-dashboard` as an isolated admin module first; extract to `qc-admin` only when deployment, auth, branding, compliance, or team ownership require a separate app.

## Goal

Create the operational admin surface Quantum Cert needs before tenant identity migration and on-chain asset rollout. Platform admins must be able to register and manage B2B clients/companies, activate tenants, create API keys, manage purchases, grant credits, and operate the commercial lifecycle from one controlled interface.

This phase must come before the unified identity/backfill phase because B2B tenants, API keys, activation state, credit grants, and commercial terms need to exist before users/assets are migrated onto the canonical backend model.

## Current Problem

The platform has backend tenant/API-key primitives and `qc-dashboard` has an admin role concept, but there is no complete operational cockpit for B2B administration. Without it, B2B tenants would need manual database edits or ad hoc scripts for onboarding, activation, credits, purchases, and API access.

That creates operational risk:

1. B2B customers can be created without a consistent activation/commercial state.
2. API keys may be provisioned without a review, owner, expiration, rotation, or audit trail.
3. Purchases and credit grants can drift from the tenant record and later break identity/backfill/on-chain phases.
4. Platform admin and tenant admin responsibilities remain mixed.

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
- plan/limit changed;
- tenant admin invited/removed;
- white-label settings changed.

## Required Backend Surfaces

The planning phase must define API contracts for:

- platform admin tenant CRUD;
- tenant activation workflow;
- tenant plan/limit/commercial profile management;
- API key lifecycle with prefix display, hashed secret storage, expiration, rotation and revocation;
- purchase/order records or integration placeholders;
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
- purchase/credit operations panel with reason fields;
- tenant admin user/team panel;
- safe empty/loading/error states for operational work.

## Data Model Requirements

Add or confirm canonical backend storage for:

- tenant commercial profile;
- tenant activation status and activation timestamps;
- API key metadata, hashed secret, prefix, scopes, expiration and revoked metadata;
- tenant plan/limit fields;
- B2B credit ledger entries;
- purchase/order records or integration reference IDs;
- admin audit log entries tied to actor, tenant, action and payload hash;
- tenant admin membership and role assignments.

## Acceptance Criteria

1. A Quantum platform admin can create a B2B client/company from the admin area without direct DB access.
2. A created B2B client becomes a backend `Tenant` with status, commercial profile, limits and activation state.
3. A platform admin can create, rotate and revoke API keys, and only key prefix/metadata are visible after creation.
4. A platform admin can grant or adjust credits with a mandatory reason and auditable ledger entry.
5. Purchases/activation records are visible on the tenant detail page and are linked to the tenant.
6. Tenant admins can view only their own tenant operational data.
7. Every privileged mutation is protected by server-side authorization and creates an audit event.
8. This phase produces the tenant/API-key/credit foundation required by Phase 5 identity/backfill.

## Out of Scope

- Building a separate `qc-admin` app in this phase.
- Full invoicing/accounting integration.
- Public self-service B2B signup without platform review.
- Final white-label public verification UI.
- On-chain asset identity/provenance.
