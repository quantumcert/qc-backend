# Curation Layer — Design Spec
**Issue:** #7  
**Date:** 2026-05-08  
**Branch:** `7-feat-camada-de-curadoria-contribuicoes-de-nao-auditores-vao-para-fila-pendentes-de-aprovacao`

---

## Problem

Any public user can currently submit data that goes directly to blockchain anchoring. The correct model requires a curation layer: only contributors marked as auditors get direct anchoring — everyone else lands in a pending queue awaiting manual approval.

Anonymous submissions (no phone or email) must be blocked.

---

## Architecture

### New Models

**`Contributor`** — tenant-scoped registry of known contributors. Decoupled from `Owner` (which is an asset-level junction table). Unique on `[tenantId, ownerRef]`.

```prisma
model Contributor {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ownerRef  String   // phone, email, or any identifier
  isAuditor Boolean  @default(false)
  createdAt DateTime @default(now())

  @@unique([tenantId, ownerRef])
  @@index([tenantId])
}
```

**`PendingContribution`** + **`PendingContributionStatus`** enum — holds contributions from non-auditors until a tenant operator approves or rejects them.

```prisma
model PendingContribution {
  id         String                    @id @default(cuid())
  tenantId   String
  tenant     Tenant                    @relation(fields: [tenantId], references: [id])
  ownerId    String                    // phone or email of contributor
  assetId    String?
  payload    Json
  status     PendingContributionStatus @default(PENDING_APPROVAL)
  reviewedBy String?
  reviewedAt DateTime?
  createdAt  DateTime                  @default(now())

  @@index([tenantId, status])
  @@index([createdAt])
}

enum PendingContributionStatus {
  PENDING_APPROVAL
  APPROVED
  REJECTED
}
```

`Tenant` model gains two new relations: `contributors Contributor[]` and `pendingContributions PendingContribution[]`.

---

## Endpoint

```
POST /api/v1/public/asset/:assetId/contribution
```

- **Auth:** none (public)
- **Body:** `{ phone?: string, email?: string, payload: Record<string, any> }`
- **Responses:**
  - `202 Accepted` — auditor path, event enqueued for anchoring
  - `200 OK` — non-auditor path, pending approval
  - `400 Bad Request` — missing phone and email, or malformed payload
  - `404 Not Found` — asset does not exist

The route handler validates the body and delegates entirely to `CurationFacet`. No business logic in the controller.

---

## `CurationFacet`

**File:** `src/services/core-facets/CurationFacet.ts`  
**Method:** `submitContribution(params)`

```typescript
params: {
  assetId: string
  phone?: string
  email?: string
  payload: Record<string, any>
}
```

**Flow:**

1. Validate `phone` or `email` present — throw 400 if both absent
2. Fetch asset by `assetId` — throw 404 if not found
3. Derive `tenantId` from asset
4. Build `ownerRef = phone ?? email`
5. Query `Contributor` by `{ tenantId, ownerRef, isAuditor: true }`
6. **Auditor path:** create `EventLog` with `status: APPROVED`, `origin: 'PUBLIC_AUDITOR'`, SHA3-512 `signatureHash` of payload → fire-and-forget `AnchorQueueService.processQueue()`
7. **Non-auditor path:** create `PendingContribution` with `status: PENDING_APPROVAL` — anchor queue is NOT triggered

**Returns:**
- Auditor → `{ queued: true, eventId: string }`
- Non-auditor → `{ queued: false, pendingId: string }`

`CurationFacet` is called directly from the route (same pattern as `BlindContactController`). No new selector in `FacetRegistry` — the facet is not invoked through `DiamondProxy`.

---

## Tests

**File:** `src/tests/CurationFacet.test.ts` (vitest, unit)

| Case | Expected |
|---|---|
| No phone and no email | throws 400 |
| Asset not found | throws 404 |
| Contributor not registered | creates `PendingContribution` PENDING_APPROVAL, AnchorQueue NOT called |
| Contributor with `isAuditor: false` | same as above |
| Contributor with `isAuditor: true` | creates `EventLog` APPROVED, AnchorQueue called |

Prisma is mocked via `vitest.mock` on `../../config/prisma`.

---

## Out of Scope

- Operator UI for reviewing `PendingContribution` records (tracked in qc-dashboard#17)
- Diamond selector for `contribution.submit` (not needed — public route calls facet directly)
- `Contributor` management endpoints (CRUD for registering auditors — separate issue)
