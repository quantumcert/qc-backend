# Phase 2: Document Verification + QTAG Production - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 02-Document Verification + QTAG Production
**Areas discussed:** Public verification route, Public payload and privacy, qc-record-module to Diamond bridge, QTAG production commissioning, Suspicious QTAG verification

---

## Public Verification Route

| Question | Options Presented | User's Choice |
|----------|-------------------|---------------|
| What should be the canonical route? | `/api/v1/verify/document/{hash}` as in roadmap and requirements; `/api/v1/public/verify/document/{hash}` as currently implemented; support both routes with one documented as canonical | `/api/v1/public/verify/document/{hash}` |
| How should the alternative route be handled? | Keep compatibility permanently; keep for now and mark deprecated in OpenAPI; remove/rename now to avoid ambiguity | Remove or avoid adding `/api/v1/verify/document/{hash}` |
| What should invalid hashes return? | `400` with structured error; `404 { verified: false }`; `200 { verified: false, reason: "INVALID_HASH" }` | `400` with structured error |
| What should missing documents return? | `404 { verified: false }`; `200 { verified: false }`; `404` with structured error and code `DOCUMENT_NOT_FOUND` | `404` with structured error and code `DOCUMENT_NOT_FOUND` |

**Notes:** The existing implementation already uses the selected public route.

---

## Public Payload and Privacy

| Question | Options Presented | User's Choice |
|----------|-------------------|---------------|
| What should the verified response envelope be? | Simple public envelope; current flat fields; standard API envelope | Current flat fields |
| Which tenant/issuer identity can appear publicly? | Public tenant name/slug only; `issuerId` can appear; no tenant/issuer data | `issuerId` can appear for now |
| What should be exposed about the asset? | `assetId`, status, and filtered metadata; only status and public URL; no asset detail | Only status and public URL |
| What anchoring details should be exposed? | `chain`, `txId`, `timestamp`, `eventId`, confirmation status; only `txId` and timestamp; all non-secret ChainTransaction data | `chain`, `txId`, `timestamp`, `eventId`, and confirmation status |

**Notes:** The user explicitly said public `issuerId` exposure will need to change later, so this was documented as temporary.

---

## qc-record-module to Diamond Bridge

| Question | Options Presented | User's Choice |
|----------|-------------------|---------------|
| How should `qc-record-module` register the document hash? | Existing `event.recordAuthenticated` with `payload.documentHash`; new `document.record`; authenticated REST route | Existing `event.recordAuthenticated` with `payload.documentHash` |
| Where should the canonical hash live? | Only `EventLog.documentHash`; new `DocumentRecord`; both | Only `EventLog.documentHash` |
| When should the document become publicly verifiable? | As soon as `EventLog` is created; after `APPROVED` and anchored; after `APPROVED` but pending anchoring allowed | As soon as `EventLog` is created |
| How should duplicate hashes be handled? | Idempotent per tenant; globally unique; allow multiple and return latest | Idempotent per tenant |

**Notes:** The selected path avoids a new table and keeps the bridge inside the existing Diamond event flow.

---

## QTAG Production Commissioning

| Question | Options Presented | User's Choice |
|----------|-------------------|---------------|
| What should the production KMS path be? | Existing `KMSService` with tenant-scoped key; temporary tenant env var; keep production stub but block public endpoints | Existing `KMSService` with tenant-scoped key |
| How should one-time `sdmMacKey` and `writeKey` exposure work? | Return from `commissioning.start`, never persist plaintext; separate retrieve-once route; station reads directly from KMS | Return from `commissioning.start`, never persist plaintext |
| What happens if physical writing fails? | `confirm(success=false)`, then new `start`; reopen same session; reuse keys/layout | `confirm(success=false)`, then new `start` |
| What should `lockAfterWrite` do? | `true` in production, dev/test may be false; always false until hardware validation; tenant/payload configurable | `true` in production, dev/test may be false |

**Notes:** Production commissioning must fail closed when tenant-scoped key material is missing.

---

## Suspicious QTAG Verification

| Question | Options Presented | User's Choice |
|----------|-------------------|---------------|
| What should the public rejection format be? | Keep `status: "DENIED"`, `reason`, `message`; standard HTTP/error envelope; minimal `DENIED` only | Keep `status: "DENIED"`, `reason`, `message` |
| Which reasons can appear publicly? | All current reasons; safe categories only; generic message only | All current reasons |
| Which HTTP status should rejected QTAGs use? | `403` for authenticity rejection, `400` for malformed input; always `200`; `404` for missing tag and `403` for MAC/replay | `403` for authenticity rejection, `400` for malformed input |
| How should suspicious attempts be recorded? | `DeviceTapLog` for identified devices only; always audit; do not log rejections | `DeviceTapLog` for identified devices only |

**Notes:** The selected behavior keeps compatibility with the existing public scan response shape.

---

## Agent Discretion

- Planner may choose task split, test boundaries, and whether idempotency requires schema constraints, as long as the locked behavior in `02-CONTEXT.md` is preserved.

## Deferred Ideas

- Replace public `issuerId` exposure with a safer public issuer identity model in a later privacy hardening pass.
