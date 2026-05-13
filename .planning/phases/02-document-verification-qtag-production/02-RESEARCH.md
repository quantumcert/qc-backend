---
phase: 02-document-verification-qtag-production
status: complete
researched: 2026-05-13
requirements:
  - DOC-01
  - DOC-02
  - DOC-03
  - QTAG-01
  - QTAG-02
---

# Phase 2 Research — Document Verification + QTAG Production

## Research Complete

Phase 2 can be planned as three backend slices:

1. Public document verification contract and qc-record-module bridge.
2. Production QTAG commissioning using tenant-scoped KMS material.
3. Public QTAG scan verification hardening and rejection audit behavior.

No UI work is required for this backend phase.

## Existing Assets

### Public Document Verification

- `src/routes/v1/publicRoutes.ts` already mounts `GET /api/v1/public/verify/document/:hash` under `/api/v1/public`, which matches the locked context decision D-01 and intentionally differs from the older roadmap wording `/api/v1/verify/document/{hash}`.
- `src/services/core-facets/DocumentVerificationFacet.ts` already validates SHA3-512 shape and looks up `EventLog.documentHash`.
- `src/diamond/FacetRegistry.ts` already registers `document.verify`.
- `tests/document-verification.test.ts` already covers invalid hashes, missing documents, found documents, Diamond selector reachability, and `EventLogFacet.recordAuthenticatedEvent` capturing `documentHash`.

### Document Bridge

- `src/services/core-facets/EventLogFacet.ts` accepts `requestPayload.documentHash`, validates it as 128 hex chars, stores it in `EventLog.documentHash`, and triggers `AnchorQueueService.processQueue()`.
- Current implementation does not enforce idempotency per tenant. Repeating the same `documentHash` for the same tenant creates a new `EventLog`.
- `prisma/schema.prisma` has `EventLog.documentHash` and `@@index([documentHash])`, but no uniqueness guard. For the locked "idempotent per tenant" behavior, the robust implementation is `@@unique([tenantId, documentHash])`. PostgreSQL permits multiple `NULL` values under a unique constraint, so generic events without a document hash remain valid.

### Anchoring Metadata

- `EventLog` stores `dltTxId`, `createdAt`, `updatedAt`, `issuerId`, `assetId`, `tenantId`, and `documentHash`.
- `ChainTransaction` stores richer chain confirmation data with `txRef`, `chain`, `chainTxId`, `status`, `confirmedAt`, and `blockNumber`.
- `AlgorandAnchorFacet.anchorEvent()` creates `ChainTransaction` with `txRef: eventId`, `chain: 'ALGORAND'`, `direction: 'ANCHOR'`, and `chainTxId`.
- The public proof should load the latest anchor transaction by `txRef = EventLog.id` and direction `ANCHOR`. When no `ChainTransaction` exists yet, it can still return the flat verified payload with `dltTxId`, `eventId`, and `anchoredAt`, plus a conservative confirmation status.

### QTAG Commissioning

- `src/services/core-facets/CommissioningFacet.ts` has `start`, `confirm`, and `statusQuery`.
- `commissioning.start` currently fails in production with `[CommissioningFacet] tenantSecretHex must be configured via KMS in production` and uses a zero-filled tenant secret in non-production.
- `KMSService.getQuantumMasterKey()` already fails closed outside test mode when `QUANTUM_CERT_SECRET` is absent, and `wrapUserKey()` / `unwrapUserKey()` already use that master key.
- Plaintext `sdmMacKey` and `writeKey` are returned only from `commissioning.start`; only KMS-wrapped `sdmMacKeyId` and `sdmEncKeyId` are persisted in `EncodingSession`.
- `confirm(success=false)` marks a session `FAILED` and does not upsert a `Device`, which matches the locked physical-write-failure path.
- `lockAfterWrite` currently always returns `false`; it needs to default to `true` in production and remain `false` in dev/test unless explicitly configured.

### QTAG Scan Verification

- `src/routes/index.ts` exposes unauthenticated `GET /api/v1/scan`.
- `SDMVerifierService.verifyTap()` already returns public `status: 'DENIED'`, `reason`, and `message`, and the route maps denied authenticity to HTTP `403`.
- Malformed scan input throws `INVALID_INPUT`, and the route maps it to HTTP `400`.
- `SDMVerifierService` logs `DeviceTapLog` only for valid taps today. Rejections such as `MAC_INVALID`, `REPLAY_ATTACK`, `RELAY_ATTACK`, and `DEVICE_INACTIVE` are identifiable after device lookup and should be logged. `DEVICE_NOT_FOUND` should not be logged when no device is identifiable.
- `DeviceGuardFacet` already contains a useful `TapVerdict` mapping and rejection logging pattern that can be mirrored without changing the public response envelope.

## Implementation Recommendations

### Public Verification

- Keep the canonical route exactly `/api/v1/public/verify/document/{hash}`. Do not add `/api/v1/verify/document/{hash}`.
- Make `DocumentVerificationFacet.verifyByHash()` return typed failure reasons:
  - `INVALID_DOCUMENT_HASH` for malformed hashes.
  - `DOCUMENT_NOT_FOUND` for absent document hashes.
- Map `INVALID_DOCUMENT_HASH` to HTTP `400` and `DOCUMENT_NOT_FOUND` to HTTP `404` in `publicRoutes.ts`.
- Preserve the flat success payload: `assetId`, `assetStatus`, `publicUrl`, `dltTxId`, `chain`, `anchoredAt`, `eventId`, `issuerId`, and `confirmationStatus`.
- Keep `issuerId` visible only because this phase explicitly accepts it as temporary debt; do not expose tenant name, API key material, asset metadata, or owner data.

### Idempotency

- Add `@@unique([tenantId, documentHash])` to `EventLog` in `prisma/schema.prisma`.
- In `EventLogFacet.recordAuthenticatedEvent()`, after the asset is loaded and the request tenant is authorized, if `documentHash` is present, query for an existing `EventLog` with `{ tenantId: asset.tenantId, documentHash }`.
- If found, return that event and do not create a new audit record or re-trigger `AnchorQueueService`.
- Add a blocking schema push task to the plan after schema modification: `npx prisma db push`.

### Production QTAG Commissioning

- Do not derive a short HMAC tenant secret and pass it to `QuantumSignerService.signPayload()`: `PostQuantumCrypto.signPayloadFalcon512()` treats secrets shorter than a real Falcon-512 private key as dev/test input and generates a process-local cached key. That would not be stable production key material across restarts.
- Add a tenant secret registry managed by KMS, e.g. a Prisma `TenantSecret` model with `tenantId`, `purpose`, `encryptedSecret`, `publicKeyB64`, `keyType`, `keyWrapVersion`, `isActive`, and timestamps. The encrypted secret stores a real Falcon-512 private key hex wrapped by `KMSService.wrapUserKey()`.
- Add async KMS methods such as `storeTenantSecretHex(tenantId, purpose, secretHex, publicKeyB64?)` and `getTenantSecretHex(tenantId, purpose)`.
- `storeTenantSecretHex()` must reject Falcon private keys shorter than 4610 hex chars.
- `getTenantSecretHex()` must fail closed with a typed code such as `TENANT_SECRET_NOT_CONFIGURED` when no active tenant-scoped secret exists.
- Replace the non-production zero secret in `CommissioningFacet.start()` with `await kms.getTenantSecretHex(ctx.tenantId, 'qtag-commissioning')`.
- Keep plaintext SDM/write keys one-time only in the return payload; never persist `writeKey`.
- Set `lockAfterWrite` to `process.env.NODE_ENV === 'production'` unless `payload.lockAfterWrite` is explicitly provided later. For this phase, production default true is enough.

### QTAG Rejection Audit

- Add a helper such as `private static async logDeniedTap(device, input, reason, cmacValid, ctr?)` in `SDMVerifierService`.
- Call it for identifiable-device denials:
  - `DEVICE_INACTIVE`
  - `MAC_INVALID`
  - `REPLAY_ATTACK`
  - `RELAY_ATTACK`
- Do not create `DeviceTapLog` when no device is found or decrypted UID does not identify the device.
- Use existing `TapVerdict` enum values:
  - `MAC_INVALID` -> `CMAC_INVALID`
  - `REPLAY_ATTACK` -> `REPLAY_BLOCKED`
  - `RELAY_ATTACK` -> `RELAY_ATTACK`
  - `DEVICE_INACTIVE` -> `DEVICE_INACTIVE`
- Preserve public HTTP statuses: `403` for denied authenticity and `400` for malformed scan input.

## Validation Architecture

Use the existing Vitest suite and focus tests around externally observable contracts.

### Required Automated Tests

- `tests/document-verification.test.ts`
  - invalid hash returns internal reason `INVALID_DOCUMENT_HASH` without DB lookup.
  - public route maps invalid hash to HTTP `400` with `success: false`, `code: 'INVALID_DOCUMENT_HASH'`.
  - missing document maps to HTTP `404` with `success: false`, `code: 'DOCUMENT_NOT_FOUND'`.
  - success response includes flat proof fields and excludes tenant secret/metadata/owner data.
  - duplicate `documentHash` for same tenant returns the existing event and does not call `eventLog.create`.
- `tests/commissioning.test.ts`
  - `commissioning.start` calls KMS tenant-secret lookup with `ctx.tenantId` and `qtag-commissioning`.
  - production start does not throw the old stub error when KMS has `QUANTUM_CERT_SECRET`.
  - production start returns `lockAfterWrite: true`.
  - `sdmMacKey` and `writeKey` are returned once and only wrapped SDM keys are persisted.
  - `confirm(success=false)` marks session `FAILED` and does not upsert `Device`.
- `tests/sdm-verifier.test.ts`
  - denied `MAC_INVALID`, `REPLAY_ATTACK`, `RELAY_ATTACK`, and `DEVICE_INACTIVE` responses keep `status`, `reason`, and `message`.
  - identifiable denials create `DeviceTapLog` with the expected `TapVerdict`.
  - `DEVICE_NOT_FOUND` without an identified device creates no tap log.
- A route-level scan test if an existing request test harness is available:
  - `/api/v1/scan` returns `403` for `DENIED`.
  - malformed `p`/`m` returns `400`.

### Verification Commands

- `npx vitest run tests/document-verification.test.ts`
- `npx vitest run tests/commissioning.test.ts`
- `npx vitest run tests/sdm-verifier.test.ts`
- `npm run build`
- `git diff --check`

## Risks and Mitigations

- **Route drift risk:** ROADMAP/REQUIREMENTS still mention `/api/v1/verify/document/{hash}`, but `02-CONTEXT.md` locks `/api/v1/public/verify/document/{hash}`. Plans must cite the context decision and avoid adding the older route.
- **Schema-push risk:** Adding `@@unique([tenantId, documentHash])` or `TenantSecret` can require a Prisma push. Execution should include duplicate checks for document hashes and a blocking `npx prisma db push` after schema changes.
- **QTAG hardware risk:** Physical NFC writing cannot be fully automated in backend tests. The plan should verify backend session/key behavior automatically and leave physical write as manual UAT.
- **Privacy risk:** `issuerId` remains public by explicit temporary decision. Plans should keep this visible but document it as deferred privacy debt.
