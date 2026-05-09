# Phase 2: Document Verification + QTAG Production - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers public document verification by SHA3-512 hash and production-ready QTAG/NFC commissioning. The public document verification path stays unauthenticated and exposes only the agreed proof fields. The QTAG path must move from dev-only commissioning to production behavior using tenant-scoped KMS material and must keep suspicious tag verification behavior compatible with the existing scan response model.

</domain>

<decisions>
## Implementation Decisions

### Public Verification Route
- **D-01:** The canonical public route is `/api/v1/public/verify/document/{hash}`.
- **D-02:** Do not add or keep `/api/v1/verify/document/{hash}` as an alternative route for this phase.
- **D-03:** Invalid document hashes return `400` with a structured error.
- **D-04:** Missing documents return `404` with a structured error and code `DOCUMENT_NOT_FOUND`.

### Public Payload and Privacy
- **D-05:** Keep the current flat verified response shape: `assetId`, `assetStatus`, `dltTxId`, `anchoredAt`, `eventId`, and `issuerId`.
- **D-06:** `issuerId` may appear publicly for now, without other sensitive details. This is a temporary decision and must be revisited in a later privacy hardening pass.
- **D-07:** Asset disclosure should be limited to status and public URL; do not expose detailed asset metadata in the document verification response.
- **D-08:** Anchoring disclosure should include `chain`, `txId`, `timestamp`, `eventId`, and confirmation status when available.

### qc-record-module to Diamond Bridge
- **D-09:** `qc-record-module` should register document hashes through the existing `event.recordAuthenticated` selector using `payload.documentHash`.
- **D-10:** The canonical document hash stays in `EventLog.documentHash`; do not introduce a `DocumentRecord` table in this phase.
- **D-11:** A document becomes publicly verifiable as soon as the `EventLog` is created.
- **D-12:** Duplicate document hashes are idempotent per tenant: the same tenant receives the existing record.

### QTAG Production Commissioning
- **D-13:** Production commissioning must use `KMSService` with a real tenant-scoped key and fail if no tenant secret is configured.
- **D-14:** `commissioning.start` continues returning `sdmMacKey` and `writeKey` one time, but plaintext keys must never be persisted.
- **D-15:** If physical writing fails, the client calls `commissioning.confirm(success=false)` and then starts a new commissioning session with fresh keys.
- **D-16:** `lockAfterWrite` is `true` by default in production; dev/test may keep it `false`.

### Suspicious QTAG Verification
- **D-17:** Public QTAG rejection keeps the existing shape: `status: "DENIED"`, `reason`, and `message`.
- **D-18:** Current technical reasons may appear publicly: `MAC_INVALID`, `REPLAY_ATTACK`, `RELAY_ATTACK`, `DEVICE_NOT_FOUND`, and `DEVICE_INACTIVE`.
- **D-19:** QTAG authenticity rejection returns HTTP `403`; malformed scan input returns `400`.
- **D-20:** Create `DeviceTapLog` for rejection attempts when the device is identified; do not log when no device is identifiable.

### Agent Discretion
- Planner may choose the implementation sequence and test split, but must preserve the route, payload, KMS, idempotency, and QTAG rejection decisions above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/PROJECT.md` — project identity, subsystem boundaries, and platform context.
- `.planning/REQUIREMENTS.md` — Phase 2 requirements `DOC-01`, `DOC-02`, `DOC-03`, `QTAG-01`, and `QTAG-02`.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, GitHub milestone, and issue mapping.
- `.planning/STATE.md` — current project state and prior Phase 1 closure decisions.

### Codebase Maps
- `.planning/codebase/STACK.md` — runtime, frameworks, and NFC/PQC dependencies.
- `.planning/codebase/ARCHITECTURE.md` — Diamond routing, public route strategy, Facet boundaries, EventLog, Device, and QTAG architecture.
- `.planning/codebase/INTEGRATIONS.md` — blockchain/KMS/NFC integration context and production environment gaps.

### Existing Implementation
- `src/routes/v1/publicRoutes.ts` — existing public document verification route and OpenAPI block.
- `src/services/core-facets/DocumentVerificationFacet.ts` — current document hash lookup and flat response shape.
- `src/diamond/FacetRegistry.ts` — existing `document.verify`, `event.recordAuthenticated`, and commissioning selectors.
- `src/services/core-facets/EventLogFacet.ts` — existing `documentHash` capture path for authenticated event recording.
- `src/services/core-facets/CommissioningFacet.ts` — current dev-only tenant secret stub and commissioning session behavior.
- `src/services/SDMVerifierService.ts` — current public QTAG scan verification, denial reasons, and tap logging behavior.
- `src/routes/index.ts` — current unauthenticated `/api/v1/scan` endpoint and HTTP status behavior.
- `src/server.ts` — current scan rate limiting and route mounting.
- `prisma/schema.prisma` — `EventLog.documentHash`, device/session models, and indexing.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DocumentVerificationFacet.verifyByHash` already validates SHA3-512 shape and performs reverse lookup through `EventLog.documentHash`.
- `publicRoutes.ts` already mounts `/api/v1/public/verify/document/:hash`, matching the chosen canonical route.
- `EventLogFacet.recordAuthenticatedEvent` already accepts and validates `payload.documentHash`, matching the bridge decision.
- `CommissioningFacet` already has `start`, `confirm`, and `statusQuery` selectors and already avoids persisting plaintext SDM/write keys.
- `SDMVerifierService.verifyTap` already returns `DENIED` with `reason` and `message`, and already uses `403` for rejected scans in `routes/index.ts`.

### Established Patterns
- Public endpoints are unauthenticated and live under `/api/v1/public/*` or purpose-specific public routes such as `/api/v1/scan`.
- Authenticated business capabilities should stay in Facets and be reached through Diamond selectors unless there is a deliberate REST facade.
- Tenant identity must come from secure middleware context, never request body.
- Public asset disclosure is controlled by explicit public fields such as `publicUrl` and `publicDataKeys`; this phase narrows document verification disclosure further.
- KMS is the existing abstraction for secrets; production code must fail closed when required tenant material is unavailable.

### Integration Points
- Public document verification connects at `src/routes/v1/publicRoutes.ts` and `src/services/core-facets/DocumentVerificationFacet.ts`.
- Document registration from `qc-record-module` connects through `src/diamond/FacetRegistry.ts` selector `event.recordAuthenticated` and `src/services/core-facets/EventLogFacet.ts`.
- Production QTAG commissioning connects through `src/services/core-facets/CommissioningFacet.ts`, `src/services/KMSService.ts`, and the Prisma `EncodingSession`/`Device` models.
- Suspicious QTAG handling connects through `src/services/SDMVerifierService.ts`, `src/routes/index.ts`, and `DeviceTapLog`.

</code_context>

<specifics>
## Specific Ideas

- Keep the document verification response close to the existing flat implementation to reduce API churn.
- Treat public `issuerId` exposure as temporary compatibility, not a final privacy model.
- Avoid adding a new document table or selector unless planning finds it unavoidable for idempotency.
- Keep one-time key exposure in `commissioning.start` because the physical writing station needs the material immediately.

</specifics>

<deferred>
## Deferred Ideas

- Replace public `issuerId` exposure with a safer public issuer identity model in a later privacy hardening pass.

</deferred>

---

*Phase: 2-Document Verification + QTAG Production*
*Context gathered: 2026-05-09*
