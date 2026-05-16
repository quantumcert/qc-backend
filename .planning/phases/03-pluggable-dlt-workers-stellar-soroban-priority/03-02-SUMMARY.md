---
phase: 03-pluggable-dlt-workers-stellar-soroban-priority
plan: 02
subsystem: public-verification
tags: [document-verification, blockchain-proof, stellar-explorer, x402, openapi]
requires:
  - phase: 03-pluggable-dlt-workers-stellar-soroban-priority
    plan: 01
    provides: Tenant-safe Stellar ChainTransaction proof rows
provides:
  - Chain-agnostic blockchain proof object on public document verification
  - Stellar Expert testnet explorer URL generation
  - Route-scoped optional x402 payment gate, disabled by default and fail-closed when enabled
  - OpenAPI documentation for blockchain proof and 501 payment-provider failure
affects: [phase-3, document-verification, public-api, qc-dashboard]
tech-stack:
  added: []
  patterns: [chain-agnostic-public-proof, route-scoped-payment-gate, fail-closed-disabled-by-default]
key-files:
  created:
    - src/utils/blockchainExplorer.ts
    - src/middleware/documentPaymentGate.ts
    - tests/document-payment-gate.test.ts
  modified:
    - src/services/core-facets/DocumentVerificationFacet.ts
    - src/routes/v1/publicRoutes.ts
    - src/config/env.ts
    - .env.example
    - tests/document-verification.test.ts
    - tests/docs.test.ts
key-decisions:
  - "Public proof uses a generic blockchain object; no stellarTxId or stellarExplorerUrl fields were added."
  - "x402 remains a nice-to-have hook: X402_ENABLED=false by default and X402_ENABLED=true fails closed until a real provider is implemented."
  - "Future payment provider direction is documented as Anchor/BRZ, with Transfero as the current candidate."
requirements-completed: [DLT-01, DLT-03, DLT-04]
duration: 6 min
completed: 2026-05-14
---

# Phase 03 Plan 02: Public Blockchain Proof + Optional Payment Hook Summary

**Public document verification now returns chain-agnostic blockchain proof metadata and has an opt-in payment gate that is safe by default.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-14T02:55:00Z
- **Completed:** 2026-05-14T03:01:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added `buildExplorerUrl(chain, txId)` with Stellar Expert testnet support and `null` fallback for unknown chains or missing transaction ids.
- `DocumentVerificationFacet.verifyByHash()` keeps Phase 2 flat fields and adds `blockchain` as either `null` or `{ dltTxId, explorerUrl, chain, anchoredAt }`.
- Public route `GET /api/v1/public/verify/document/:hash` now returns `blockchain` without adding Stellar-specific top-level fields.
- Added `createDocumentPaymentGate()` and applied it only to public document verification.
- Added x402 env defaults to `.env.example` and `src/config/env.ts`; no `@x402/*` package was installed.
- Updated OpenAPI to document `blockchain`, the optional x402 behavior, and `501 PAYMENT_PROVIDER_NOT_CONFIGURED`.

## Task Commits

1. **Public blockchain proof and optional payment gate** - `b4cf641` (`feat(03-02)`)

## Files Created/Modified

- `src/utils/blockchainExplorer.ts` - centralizes explorer URL generation by chain.
- `src/services/core-facets/DocumentVerificationFacet.ts` - adds `blockchain` proof while preserving flat response fields.
- `src/middleware/documentPaymentGate.ts` - implements disabled-by-default x402 route gate and fail-closed 501 response.
- `src/routes/v1/publicRoutes.ts` - applies the payment gate only to document verification and documents the new public contract.
- `src/config/env.ts` and `.env.example` - add optional x402 configuration with Anchor/BRZ defaults.
- `tests/document-verification.test.ts` - covers null proof, Stellar explorer URL, future chain fallback, privacy exclusions, and flat field preservation.
- `tests/document-payment-gate.test.ts` - covers disabled default, explicit false, fail-closed true, and scan route scope.
- `tests/docs.test.ts` - validates OpenAPI `blockchain` and `501` docs.

## Decisions Made

- `explorerUrl` is generated server-side so dashboard clients can remain chain-agnostic.
- Unknown future chains still produce `blockchain` proof when a transaction id and chain exist, but `explorerUrl` stays `null` until that chain is mapped.
- Payment enforcement is intentionally non-commercialized in this phase; enabling it without a provider returns a structured 501 instead of pretending settlement happened.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## Verification

- `grep -c "buildExplorerUrl" src/services/core-facets/DocumentVerificationFacet.ts` - passed
- `grep -c "stellar.expert/explorer/testnet/tx" src/utils/blockchainExplorer.ts` - passed
- `grep -c "blockchain" tests/document-verification.test.ts` - passed
- `grep -c "X402_ENABLED" .env.example` - passed
- `grep -c "createDocumentPaymentGate" src/routes/v1/publicRoutes.ts` - passed
- `grep -c "PAYMENT_PROVIDER_NOT_CONFIGURED" src/middleware/documentPaymentGate.ts` - passed
- `grep -n "@x402/" package.json` - no matches
- `npx vitest run tests/document-verification.test.ts tests/document-payment-gate.test.ts tests/docs.test.ts` - 30 passed
- `npx tsx -e "import { getSpec } from './src/docs/openapi'; ..."` - `OPENAPI_DOCUMENT_PROOF_OK 3.0.0`
- `npm run build` - passed
- `git diff --check` - passed

## User Setup Required

None. `X402_ENABLED=false` keeps public document verification free by default.

## Next Phase Readiness

Ready for Plan 03-03: dashboard can render `blockchain` for any chain and link out when `explorerUrl` is present.

## Self-Check: PASSED

---
*Phase: 03-pluggable-dlt-workers-stellar-soroban-priority*
*Completed: 2026-05-14*
