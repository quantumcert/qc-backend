---
phase: 04
slug: b2b-admin-operations-console
status: approved
shadcn_initialized: true
preset: new-york
created: 2026-05-17
reviewed_at: 2026-05-17
---

# Phase 04 - UI Design Contract

> Visual and interaction contract for the B2B Admin Operations Console in `qc-dashboard`.

---

## Product UI Boundary

Phase 04 adds an operational admin module inside `qc-dashboard`, not a separate `qc-admin` app.

Required route areas:

- `/admin/platform` - Quantum Platform Admin, cross-tenant operations.
- `/admin/platform/tenants` - tenant/company list.
- `/admin/platform/tenants/:tenantId` - tenant detail hub.
- `/admin/platform/queues/activations` - tenant activation queue.
- `/admin/platform/queues/payments` - purchase/receivables queue.
- `/admin/platform/queues/qtags` - QTAG fulfillment queue.
- `/admin/platform/audit` - cross-tenant audit/request search.
- `/admin/tenant` - B2B Tenant Admin, current-tenant-only operations.

The admin module must be visually separated from the regular `/app` user workflows, but it must still reuse the existing `qc-dashboard` design system, auth shell, tRPC and shadcn/Radix components.

Hidden navigation is not a security control. Every admin route must pair visual access with server-side authorization through `adminProcedure` or a stricter platform/tenant admin procedure.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn |
| Preset | `new-york` |
| Component library | Radix UI via shadcn components |
| Icon library | `lucide-react` |
| Font | inherit current app font stack from Tailwind/browser default; do not introduce a new font in this phase |
| Styling | Tailwind CSS v4 with CSS variables from `client/src/index.css` |
| Primary layout | Sidebar shell plus dense admin content area |
| Data density | Operational/dense, table-first, not marketing/card-first |

Approved components:

- `Sidebar`, `Table`, `Tabs`, `Card`, `Dialog`, `AlertDialog`, `Sheet`, `Badge`, `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `DropdownMenu`, `Tooltip`, `Empty`, `Skeleton`, `Pagination`, `ScrollArea`.

Component constraints:

- Use `Table` for tenant lists, API keys, payments, request audit and QTAG queues.
- Use `Tabs` inside tenant detail for major domains: Overview, Profile, API Keys, Credits, Purchases, QTAGs, Requests, Audit, Team.
- Use `Card` only for individual metrics, panels and repeated operational items. Do not nest cards inside cards.
- Use `Dialog`/`AlertDialog` for create, rotate/revoke, grant/adjust and destructive confirmation flows.
- Use `Sheet` for secondary detail drawers from queue/list rows.
- Use `Badge` for status labels and queue states.
- Use `Tooltip` on icon-only controls.

---

## Screen Architecture

### Platform Admin Shell

Primary left nav group:

- Platform Overview
- Tenants
- Activations
- Purchases
- Credits
- QTAG Queue
- API Requests
- Audit

Tenant Admin nav group:

- Tenant Overview
- API Keys
- Credits
- QTAGs
- Team
- Audit

Admin routes must show an admin scope marker in the page header:

- `Platform Admin` for cross-tenant pages.
- `Tenant Admin` for current tenant pages.

The marker must not be the only access control. It is a visibility cue only.

### Tenant List

Layout:

- Header row: title `Clientes B2B`, description, primary CTA `Cadastrar cliente`.
- Filter row: search input, status select, plan select, risk/status quick filters.
- Main content: table, not cards.
- Columns: Company, Tenant slug, Status, Plan, Chain, Credits, QTAGs, API Keys, Last API call, Updated, Actions.
- Row action menu: View details, Activate, Suspend, Archive, Add API key.
- Create form includes a chain select with `Stellar` preselected and backed by the tenant `targetChain` contract.

Primary focal point:

- The status/action cluster in the table row, because operators need to know which tenants are blocked.

### Tenant Detail Hub

Header:

- Company name, tenant slug, status badge, plan badge, chain badge.
- Primary action depends on status:
  - `Ativar tenant`
  - `Adicionar API key`
  - `Suspender tenant`
- Secondary actions: Edit profile, View audit.
- Profile edit form includes the tenant target-chain select; saving profile changes must persist the chain and refresh the tenant-profile Asset/event context.

Top metric strip:

- Assets
- Credits available
- QTAGs available/reserved
- Active API keys
- API calls 24h
- Open incidents/queue items

Tabs:

- Overview
- Profile
- API Keys
- Credits
- Purchases
- QTAGs
- Requests
- Audit
- Team

### Tenant Team/Users Tab

The Team tab in `/admin/platform/tenants/:tenantId` is a Platform Admin operational surface, not only a Tenant Admin placeholder.

Layout:

- Header row: title `Usuários do tenant`, description, primary CTA `Adicionar usuário`.
- Filter row: search input, role select, status select, profile Asset state select.
- Main content: table with a detail drawer for each user.
- Columns: User, Email/phone/document, Role, Status, External identity, Profile Asset, Associated Assets, Last activity, Updated, Actions.

Actions:

- Create tenant user/operator.
- Edit existing tenant user profile and contact fields.
- Change role/status within server-side policy.
- Link or review external identity metadata.
- Open profile Asset/public URL state when available.
- Open associated Assets filtered by owner/delegation.

Rules:

- User creation/editing from Platform Admin must always be scoped to the selected tenant.
- The UI must show whether the user profile has a canonical Asset reference, is pending backfill, or is not yet eligible for on-chain anchoring.
- Associated Assets are read-only in this tab unless a separate ownership transfer/delegation flow exists.
- Full Tenant Admin self-service invitations and operator lifecycle are Phase 5; Phase 4 only needs constrained own-tenant visibility in `/admin/tenant`.

### Operational Queues

Queues are first-class pages, not just tenant detail tabs.

Common queue table fields:

- Status
- Tenant
- Reference
- Created
- Owner/actor
- SLA/age
- Next action

QTAG queue fields:

- Order
- Tenant
- Asset
- Owner
- Status
- Encoder/operator
- Attempts
- Dispatch/tracking
- Updated
- Actions

Purchase/receivables queue fields:

- Order
- Tenant
- Provider
- Amount
- Status
- Provider event
- Last update
- Actions

Activation queue fields:

- Tenant
- Company
- Status
- Plan
- Missing data
- Requested by
- Created
- Actions

### API Request Audit

The audit page must be optimized for filtering:

- Tenant selector
- API key prefix selector
- Endpoint/selector search
- Status code filter
- Time range
- Correlation id search

Audit rows must never show raw API keys, request bodies or sensitive payloads.

---

## Spacing Scale

Declared values must be multiples of 4:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge icon gaps, table cell micro-gaps |
| sm | 8px | Compact button gaps, table cell padding, toolbar item gaps |
| md | 16px | Default panel padding, form groups, tab content gaps |
| lg | 24px | Page section gaps, header/action separation |
| xl | 32px | Page-level grid gaps |
| 2xl | 48px | Major vertical breaks, rare |
| 3xl | 64px | Avoid in admin module except empty state vertical centering |

Exceptions:

- Sidebar width uses the existing resizable behavior from `DashboardLayout`.
- Minimum touch target for icon-only controls is 36px desktop and 44px mobile.
- Table row height target is 44px desktop for dense scanning.

---

## Typography

Use exactly four sizes and two weights in new admin surfaces.

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Label | 12px | 500 | 1.3 | table metadata, badges, helper labels |
| Body | 14px | 400 | 1.5 | table cells, forms, descriptions |
| Heading | 20px | 600 | 1.25 | panel and tab headings |
| Display | 28px | 600 | 1.2 | page title only |

Rules:

- No viewport-based font scaling.
- Letter spacing must remain `0`, except uppercase micro-labels may use existing Tailwind tracking only if already present in the component pattern.
- Do not use hero-scale typography inside admin surfaces.
- Table cells use 14px body; metadata uses 12px label.

---

## Color

Use the existing Quantum Cert CSS variables, but admin screens must be calmer than the consumer dashboard. The visual read should be operational and audit-focused, not neon or promotional.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `hsl(var(--background))` | page background |
| Secondary (30%) | `hsl(var(--card))`, `hsl(var(--muted))`, `hsl(var(--sidebar))` | panels, tables, filters, sidebar |
| Accent (10%) | `hsl(var(--primary))` | primary CTA, active nav item, active tab, focus ring, selected row marker |
| Positive | `#16a34a` | active/confirmed/success states only |
| Warning | `#d97706` | pending/review/retry states only |
| Destructive | `hsl(var(--destructive))` | revoke, suspend, archive, cancel, refund |

Accent reserved for:

- primary CTA on the current screen;
- active nav item;
- active tab;
- focus ring;
- selected row marker;
- the single most important status in a metric strip.

Accent must not be used for every button, badge or link. Secondary and outline variants should be the default for routine admin actions.

Status colors:

- `DRAFT`: muted/outline
- `PENDING_REVIEW`: warning
- `ACTIVE`: positive
- `SUSPENDED`: destructive outline
- `ARCHIVED`: muted
- `PAYMENT_CONFIRMED`: positive
- `PAYMENT_FAILED`: destructive
- `QTAG_RESERVED`: warning
- `QTAG_ACTIVATED`: positive
- `QTAG_FAILED`: destructive

---

## Visual Hierarchy

Primary screen focal points:

- Tenant list: status and next action.
- Tenant detail: tenant status, credits/QTAG/API metrics, then tabs.
- Activation queue: oldest pending review item.
- Payments queue: failed/reversed/awaiting-provider items.
- QTAG queue: failed encoding/retry and ready-for-dispatch items.
- API request audit: filters and anomalous status codes.

Hierarchy rules:

- Page title and primary action sit in a single header row.
- Filters sit directly below page header, before table content.
- Tables dominate list and queue pages.
- Metric cards are secondary summaries and must not replace tables.
- Destructive actions are always visually separated from primary actions.
- Empty states are compact and action-oriented, not illustrative.

---

## Interaction Contract

### Table Behavior

- All operational lists must support loading, empty, error and filtered-empty states.
- Tenant list and queues must support pagination before infinite scroll.
- Sorting required on Created/Updated/SLA/Last API call.
- Row click opens detail; action menu handles destructive or secondary actions.
- Bulk actions are out of scope unless explicitly planned later.

### Forms

Tenant create/edit form fields:

- Company name
- Tenant slug
- Legal/tax id
- Contact email
- Billing owner
- Plan
- Limits
- White-label metadata placeholder
- Internal notes

API key create form:

- Label
- Role/scope
- Expiration
- Reason

Credit grant/adjust form:

- Amount
- Ledger entry type
- Reason
- Reference object

QTAG reservation form:

- Asset selector
- Shipping recipient
- Notes

Every privileged mutation form must require a reason if it changes activation, API key state, credit ledger, payment state or QTAG state.

### Destructive Confirmations

Use `AlertDialog` with explicit confirmation copy for:

- Suspend tenant
- Archive tenant
- Revoke API key
- Cancel fulfillment order
- Refund/revoke credit
- Release reserved QTAG

The confirm button text must include the action and target type, for example `Suspender tenant`, not `Confirmar`.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Platform admin primary CTA | `Cadastrar cliente` |
| Tenant detail activation CTA | `Ativar tenant` |
| API key CTA | `Adicionar API key` |
| Credit grant CTA | `Conceder créditos` |
| QTAG reservation CTA | `Reservar QTAG para asset` |
| Empty tenant list heading | `Nenhum cliente B2B cadastrado` |
| Empty tenant list body | `Cadastre o primeiro cliente para ativar tenant, API keys, créditos e operação QTAG.` |
| Empty queue heading | `Nenhuma pendência operacional` |
| Empty queue body | `Quando houver ativações, pagamentos ou QTAGs aguardando ação, elas aparecerão aqui.` |
| Empty audit heading | `Nenhuma requisição encontrada` |
| Empty audit body | `Ajuste os filtros ou selecione outro tenant/API key para revisar a atividade.` |
| Generic error state | `Não foi possível carregar os dados. Tente novamente ou consulte o audit log da operação.` |
| Authorization error | `Você não tem permissão para acessar esta área. Solicite acesso de Platform Admin ou Tenant Admin.` |
| Destructive confirmation | `{Ação}: esta operação será auditada e pode afetar o acesso do tenant.` |

Copy rules:

- Use operational verbs: `Cadastrar`, `Ativar`, `Suspender`, `Emitir`, `Rotacionar`, `Revogar`, `Conceder`, `Ajustar`, `Reservar`, `Liberar`, `Reprocessar`, `Despachar`.
- Avoid vague CTAs like `Salvar`, `OK`, `Enviar`, `Confirmar`.
- Error states must include the next operational path.

---

## Loading, Empty and Error States

Loading:

- Use `Skeleton` rows for tables.
- Use compact metric skeletons for tenant detail top strip.
- Do not use full-page spinners except initial route load.

Empty:

- Use `Empty` or compact dashed panel only for true empty states.
- For filtered empty, preserve filters and show `Nenhum resultado para estes filtros`.

Error:

- Error panels must preserve page chrome and retry action.
- Authorization errors must not reveal tenant data.

---

## Accessibility

- All icon-only controls require tooltip and accessible label.
- Tables must keep semantic table markup from `components/ui/table.tsx`.
- Status badges must include text, not color-only meaning.
- Dialogs must return focus to the triggering action.
- Focus rings use `hsl(var(--ring))`.
- Mobile views must stack filters above tables and keep horizontal table scroll when needed.

---

## Responsive Contract

Desktop:

- Admin pages use max width `max-w-7xl` or full-width table container depending on table density.
- Tenant detail can use two-column layouts for profile + metrics, but tabs stay full width.

Tablet:

- Filters wrap into two rows.
- Metric strip becomes 2 columns.

Mobile:

- Preserve admin access but optimize for review, not heavy operations.
- Tables may scroll horizontally.
- Destructive workflows remain available but require confirmation dialogs.
- Header primary action moves below title if width is constrained.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | `table`, `tabs`, `dialog`, `alert-dialog`, `sheet`, `badge`, `button`, `input`, `select`, `checkbox`, `switch`, `dropdown-menu`, `tooltip`, `empty`, `skeleton`, `pagination`, `scroll-area`, `sidebar` | official local components already present |
| third-party | none | not applicable |

No third-party registry blocks are approved for this phase.

---

## Implementation Constraints For Planner

- The first dashboard slice must establish `/admin/platform` and `/admin/tenant` routing with server-side guard coverage.
- Admin UI work must not be planned before backend contracts exist for the specific workflow unless the UI is explicitly marked as local fallback/mock.
- Use tables for operational queue/list surfaces.
- Use tenant detail as the central hub.
- Do not add a marketing landing page, hero, decorative orbs, gradient hero or promotional layout to the admin module.
- Do not make a new visual identity for `qc-admin`; extraction is deferred.
- Do not depend on `backup_old` admin UI as authoritative design source.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-17
