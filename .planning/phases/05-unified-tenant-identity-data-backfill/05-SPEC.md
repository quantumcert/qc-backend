# Phase 5: B2B Tenant External Readiness — Specification

**Status:** Approved after Phase 4 scope correction
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Depends on:** Phase 4 — B2B Admin Operations Console + Tenant Quantum Backfill
**Repos:** `qc-backend`, `qc-dashboard`, `qc-home`; physical QTAG consumer: `qc-record-module`
**Business source of truth:** `qc-business`

## Goal

Prepare the platform for external B2B tenants after Phase 4 creates the admin console, canonical tenant/user foundation, Tenant Quantum and B2C backfill. Phase 5 is not the Tenant Quantum/backfill phase. It is the B2B tenant readiness phase: tenant admins, operators, API consumption, tenant-scoped operations, white-label/public boundaries and pilot cutover for real customer tenants.

This phase must complete before deeper on-chain provenance work because Phase 6 needs stable ownership and tenant boundaries for both B2C users under Tenant Quantum and B2B customers under their own tenants.

## Current Problem

Phase 4 creates the operational foundation and migrates current B2C users into Tenant Quantum. That does not automatically make the product ready for external companies to operate safely through API, tenant admin surfaces and white-label public consultation.

Remaining B2B risks:

1. B2B customers may exist as tenants but lack a complete tenant-admin lifecycle for their own users/operators.
2. API keys may work technically but remain Quantum-operated instead of tenant-consumable with scopes, docs, limits and request audit.
3. White-label/public consultation can blur with Quantum internal admin if boundaries are not made explicit.
4. A pilot B2B tenant cannot be validated end-to-end if onboarding, credits, QTAG fulfillment and public verification are still only platform-admin workflows.

## Target Model

- Tenant Quantum owns B2C consumers and current migrated users from Phase 4.
- B2B customers remain real tenants, never B2C users inside Tenant Quantum.
- Every tenant has an explicit `targetChain` for anchoring; Phase 4 defaults and normalizes this to `STELLAR`, while Phase 5 may expose tenant-safe visibility/policy for external B2B operation.
- Platform Admin Quantum controls approval, activation, commercial policy, grants and escalations.
- Tenant Admin B2B manages only its own tenant users/operators, API keys allowed by policy, credits/QTAG visibility, purchases and audit.
- API consumers operate through tenant-scoped API keys with scopes, request audit, rate limits and non-sensitive logs.
- White-label/public surfaces are tenant-aware and public-safe, but separate from Quantum internal admin.

## Required Surfaces

Backend:

- tenant-scoped B2B user/membership lifecycle;
- invitation or assignment flow for tenant admins/operators;
- API key scopes and rate-limit visibility suitable for external tenants;
- request audit queries by tenant/key/endpoint/correlation id;
- tenant credit/QTAG summaries based on Phase 4 ledgers;
- tenant-safe QTAG fulfillment visibility;
- public/white-label tenant metadata that exposes no private admin or billing data;
- pilot readiness checks that confirm B2B tenant operation without Quantum-only shortcuts.

Dashboard:

- `/admin/tenant` becomes the primary B2B tenant admin workspace;
- tenant team, API keys, credits, QTAGs, purchases and audit pages are scoped to current tenant only;
- Platform Admin-only actions remain absent or disabled server-side for Tenant Admin;
- public/white-label preview or configuration status is visible without turning into a marketing page.

Business:

- `qc-business` confirms packages, pricing, tenant activation rules, API consumption policy, QTAG packages, provider/Transfero contract status and white-label eligibility before pilot cutover.

## Acceptance Criteria

1. A B2B tenant created/activated in Phase 4 has tenant-scoped admins/operators separate from Tenant Quantum.
2. Tenant Admin B2B can invite/remove operators and view only its own tenant profile, team, API keys, credits, QTAGs, purchases and audit.
3. B2B API keys have scopes, prefixes, expiration/revocation metadata, request audit and rate-limit visibility suitable for external API use.
4. Tenant Admin B2B cannot access Platform Admin Quantum routes, cross-tenant data, grants, global activation controls or other tenants' audit.
5. White-label/public consultation boundaries are tenant-aware and public-safe, with no private admin/billing payload leakage.
6. A pilot B2B tenant can complete onboarding -> API call -> credit/QTAG operation -> public consultation using tenant-scoped contracts.
7. `qc-business` decisions needed for B2B pilot packaging/provider/commercial policy are either implemented or explicitly marked as blockers before execution.

## Out of Scope

- Re-executing Tenant Quantum/B2C dashboard user backfill; that belongs to Phase 4.
- Building a separate `qc-admin` app unless a new deployment/compliance decision explicitly overrides the Phase 4 placement decision.
- On-chain Asset registry implementation; this is Phase 6.
- Full accounting/invoicing suite beyond the provider/order/ledger foundation created in Phase 4.
