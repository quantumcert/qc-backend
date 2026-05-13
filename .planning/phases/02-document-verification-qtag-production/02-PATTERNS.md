---
phase: 02-document-verification-qtag-production
status: complete
created: 2026-05-13
---

# Phase 2 Pattern Map

## Public Route Pattern

Primary files:
- `src/routes/index.ts` mounts versioned routes under `/api`.
- `src/routes/v1/publicRoutes.ts` owns unauthenticated public routes under `/api/v1/public`.
- `src/middleware/errorHandler.ts` provides a generic `{ success: false, error, code }` pattern for known errors.

Closest analog:
- `publicRoutes.ts` contribution handler catches `err.httpStatus` and returns `{ success: false, error, code }`.

Use for Phase 2:
- Keep `GET /api/v1/public/verify/document/:hash`.
- Map invalid hash and not-found cases directly in the route instead of falling through to generic 500.

## Facet Pattern

Primary files:
- `src/services/core-facets/DocumentVerificationFacet.ts`
- `src/services/core-facets/EventLogFacet.ts`
- `src/diamond/FacetRegistry.ts`
- `src/diamond/DiamondProxy.ts`

Closest analog:
- `EventLogFacet.recordAuthenticatedEvent(secureContext, requestPayload)` validates tenant ownership, writes `EventLog`, writes `AuditLog`, then triggers `AnchorQueueService`.
- `FacetRegistry` maps selectors to static Facet methods and passes secure context first, payload second.

Use for Phase 2:
- Keep `event.recordAuthenticated` as the document-hash bridge.
- Add idempotency inside `EventLogFacet`, after asset and tenant authorization are established.
- Preserve `document.verify` selector as a public verification convenience.

## Anchor Metadata Pattern

Primary files:
- `src/services/AnchorQueueService.ts`
- `src/services/core-facets/AlgorandAnchorFacet.ts`
- `prisma/schema.prisma`

Closest analog:
- `AlgorandAnchorFacet.anchorEvent()` logs `ChainTransaction` with `txRef: eventId`, `chain`, `chainTxId`, `status`, and `confirmedAt` candidate fields.

Use for Phase 2:
- `DocumentVerificationFacet.verifyByHash()` should join `ChainTransaction` by `txRef: event.id`, `direction: 'ANCHOR'`, newest first.
- Public proof can expose `chain`, `chainTxId` as `dltTxId`, `confirmedAt` or `event.updatedAt` as `anchoredAt`, and `status` as `confirmationStatus`.

## KMS Pattern

Primary files:
- `src/services/KMSService.ts`
- `src/services/QuantumSignerService.ts`
- `src/services/core-facets/CommissioningFacet.ts`
- `tests/kms-service.test.ts`
- `tests/commissioning.test.ts`

Closest analog:
- `KMSService.getQuantumMasterKey()` derives stable master bytes from `QUANTUM_CERT_SECRET` and fails outside test mode when the secret is missing.
- `wrapUserKey()` and `unwrapUserKey()` use the master bytes and never persist plaintext keys.

Use for Phase 2:
- Store and retrieve real tenant-scoped Falcon private keys through KMS-wrapped database material.
- Do not add a temporary per-tenant plaintext environment variable.
- Keep SDM keys wrapped through KMS and keep `writeKey` ephemeral.

## QTAG Verification Pattern

Primary files:
- `src/routes/index.ts`
- `src/services/SDMVerifierService.ts`
- `src/services/QTagCryptoService.ts`
- `src/services/core-facets/DeviceGuardFacet.ts`
- `prisma/schema.prisma`
- `tests/sdm-verifier.test.ts`

Closest analog:
- `DeviceGuardFacet.logTap()` writes `DeviceTapLog` for known device failures using `TapVerdict`.
- `SDMVerifierService.verifyTap()` already exposes public `DENIED` responses with reason and message.

Use for Phase 2:
- Preserve the public response model and HTTP status mapping.
- Add logging only after a device is identified.
- Reuse `TapVerdict` mapping for `MAC_INVALID`, `REPLAY_ATTACK`, `RELAY_ATTACK`, and `DEVICE_INACTIVE`.
