---
phase: 01-core-gap-closure-production-hardening
plan: "04"
subsystem: curation-layer
tags: [curation, contribution, rbac, tenant-isolation, tdd, prisma, anchor-queue]
dependency_graph:
  requires: [01-01, 01-02, 01-03]
  provides: [CORE-05, CORE-06]
  affects: [EventLog, AnchorQueue, prisma-schema, public-routes, authenticated-routes]
tech_stack:
  added: [Contributor model, PendingContribution model, PendingContributionStatus enum]
  patterns: [auditor-bypass, pending-queue, tenant-isolation-findFirst, fire-and-forget-anchor]
key_files:
  created:
    - prisma/schema.prisma (Contributor + PendingContribution + enum PendingContributionStatus)
    - src/services/core-facets/CurationFacet.ts
    - src/controllers/ContributionController.ts
    - src/routes/v1/contributionRoutes.ts
    - tests/curation-facet.test.ts
    - tests/curation-routes.test.ts
  modified:
    - src/routes/v1/publicRoutes.ts (added POST /asset/:assetId/contribution)
    - src/routes/index.ts (mount /v1/contributions)
decisions:
  - CurationFacet not added to FacetRegistry (rota pública direta conforme spec — não via Diamond)
  - Tenant isolation via findFirst with {id, tenantId} — cross-tenant returns 404 not 403
  - AnchorQueue fire-and-forget com .catch(console.error) — TODO(OPS-03) para logger estruturado
metrics:
  duration: "~30min"
  completed: "2026-05-09"
  tasks_completed: 4
  files_created: 6
  files_modified: 2
  tests_added: 15
---

# Phase 1 Plan 04: Curation Layer Summary

**One-liner:** Curation Layer com auditor bypass para EventLog APPROVED e fila PENDING_APPROVAL para não-auditores, com revisão por OPERATOR/ADMIN e ancoragem fire-and-forget.

---

## Objective Achieved

Implementada a Curation Layer (CORE-05 + CORE-06): contribuições públicas de não-auditores entram em fila `PENDING_APPROVAL` e são revisadas por auditores (OPERATOR/ADMIN) com registro em EventLog e disparo da AnchorQueue.

---

## Novos Modelos Prisma

### `Contributor`
```prisma
model Contributor {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ownerRef  String   // phone, email, ou identifier
  isAuditor Boolean  @default(false)
  createdAt DateTime @default(now())
  @@unique([tenantId, ownerRef])
  @@index([tenantId])
}
```

### `PendingContribution`
```prisma
model PendingContribution {
  id         String                    @id @default(cuid())
  tenantId   String
  tenant     Tenant                    @relation(...)
  ownerId    String
  assetId    String?
  payload    Json
  status     PendingContributionStatus @default(PENDING_APPROVAL)
  reviewedBy String?
  reviewedAt DateTime?
  createdAt  DateTime                  @default(now())
  @@index([tenantId, status])
  @@index([createdAt])
}
```

### `enum PendingContributionStatus`
```prisma
enum PendingContributionStatus {
  PENDING_APPROVAL
  APPROVED
  REJECTED
}
```

---

## Endpoints Novos

### POST `/api/v1/public/asset/:assetId/contribution` (sem autenticação)
- Middleware: nenhum (rota pública)
- Handler: `CurationFacet.submitContribution`
- Response 201: `{ success: true, data: { queued, eventId? | pendingId? } }`

### POST `/api/v1/contributions/:id/review` (autenticado)
- Middleware chain: `requireApiKey → tenantRateLimiter → requireOperator`
- Handler: `ContributionController.review → CurationFacet.reviewContribution`
- Response 200: `{ success: true, data: { pendingId, status, eventId? } }`

---

## Fluxo Auditor vs Não-Auditor

```
POST /api/v1/public/asset/:assetId/contribution
         │
         ▼
  CurationFacet.submitContribution
         │
         ├── lookup Asset (tenantId)
         │         └── NOT FOUND → 404 ASSET_NOT_FOUND
         │
         ├── phone || email?
         │         └── NEITHER → 400 INVALID_PAYLOAD
         │
         ├── lookup Contributor[tenantId, ownerRef]
         │
         ├── [isAuditor = true]
         │         ├── create EventLog { status: APPROVED }
         │         ├── AnchorQueueService.processQueue() fire-and-forget
         │         └── return { queued: true, eventId }
         │
         └── [isAuditor = false | not found]
                   ├── create PendingContribution { status: PENDING_APPROVAL }
                   └── return { queued: false, pendingId }


POST /api/v1/contributions/:id/review
         │
         ▼
  CurationFacet.reviewContribution
         │
         ├── role = READER → 403 INSUFFICIENT_PERMISSIONS
         │
         ├── findFirst PendingContribution[id, tenantId]
         │         └── NOT FOUND → 404 CONTRIBUTION_NOT_FOUND (tenant isolation)
         │
         ├── status != PENDING_APPROVAL → 409 ALREADY_REVIEWED
         │
         ├── [decision = APPROVED]
         │         ├── $transaction:
         │         │    ├── update PendingContribution { status: APPROVED, reviewedBy, reviewedAt }
         │         │    └── create EventLog { status: APPROVED, signatureHash }
         │         ├── AnchorQueueService.processQueue() fire-and-forget
         │         └── return { pendingId, status: APPROVED, eventId }
         │
         └── [decision = REJECTED]
                   ├── update PendingContribution { status: REJECTED, reviewedBy, reviewedAt,
                   │                                payload: {..., _rejectionReason: reason} }
                   └── return { pendingId, status: REJECTED }
```

---

## Testes

- `tests/curation-facet.test.ts` — 8 testes TDD unitários (CurationFacet isolado)
- `tests/curation-routes.test.ts` — 7 testes TDD de rota (supertest)
- Total: 15 novos testes, todos passando
- Full suite: 268 testes passando (36 arquivos)

---

## Deviations from Plan

None — plano executado exatamente como especificado.

- CurationFacet NÃO adicionado ao FacetRegistry (decisão arquitetural conforme spec: rota pública direta)
- Docker container `quantumcert-postgres` iniciado manualmente (estava parado) para Task 4

---

## Security Review (STRIDE)

| Threat ID | Status | Implementation |
|-----------|--------|---------------|
| T-04-01 | accepted | Phone/email identificadores fracos por design — auditor humano valida |
| T-04-02 | mitigated | `findFirst({ id, tenantId })` — cross-tenant retorna NOT_FOUND |
| T-04-03 | mitigated | RBAC inline no Facet: `role !== 'ADMIN' && role !== 'OPERATOR'` |
| T-04-04 | mitigated | IP rate limit global (server.ts) + tenantRateLimiter no review |
| T-04-05 | accepted | Payload opaco (Golden Rule) — bodyParser 500kb limit protege HTTP |
| T-04-06 | mitigated | `reviewedBy = apiKeyId` + `reviewedAt` registrados na transação |

---

## Self-Check: PASSED

- prisma/schema.prisma: FOUND (model Contributor, model PendingContribution, enum PendingContributionStatus)
- src/services/core-facets/CurationFacet.ts: FOUND
- src/controllers/ContributionController.ts: FOUND
- src/routes/v1/contributionRoutes.ts: FOUND
- tests/curation-facet.test.ts: FOUND (8 tests)
- tests/curation-routes.test.ts: FOUND (7 tests)
- Commits: 29ea484, f9eba9c, be3b9e2
- DB push: "Your database is now in sync"
- Prisma generate: "Generated Prisma Client (v5.22.0)"
- npm run build: 0 errors
- npm test: 268 passed (36 files)
