---
phase: 03-pluggable-dlt-workers-stellar-soroban-priority
plan: 03
subsystem: dashboard-uat
tags: [qc-dashboard, public-verify, blockchain-proof, human-uat, scope-reconciliation]
requires:
  - phase: 03-pluggable-dlt-workers-stellar-soroban-priority
    plan: 02
    provides: Public blockchain proof contract
provides:
  - qc-dashboard public verification propagation for generic blockchain proof
  - qc-dashboard cross-chain blockchain proof card
  - Stellar hackathon human UAT checklist and evidence fields
  - Explicit DLT-02 and DLT-05 deferral notes
affects: [phase-3, qc-dashboard, public-api, human-uat]
tech-stack:
  added: []
  patterns: [cross-repo-contract-propagation, generic-chain-proof-ui, explicit-deferred-scope]
key-files:
  created:
    - .planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-HUMAN-UAT.md
  modified:
    - ../qc-dashboard/server/routers.ts
    - ../qc-dashboard/client/src/pages/VerifyAsset.tsx
    - ../qc-dashboard/server/verify.asset.test.ts
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
key-decisions:
  - "Dashboard renders blockchain proof for any chain string; there is no Stellar-only UI filter."
  - "Backend-QC/demo fallback remains intact: missing proof returns blockchain:null instead of failing public verify."
  - "Human Stellar testnet evidence is required before Phase 3 is ship-ready."
requirements-completed: [DLT-01, DLT-03, DLT-04]
duration: 5 min
completed: 2026-05-14
---

# Phase 03 Plan 03: Dashboard Proof Card + UAT Summary

**qc-dashboard now propagates and renders generic blockchain proof, with manual Stellar testnet UAT tracked separately.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-14T03:00:00Z
- **Completed:** 2026-05-14T03:05:00Z
- **Tasks:** 3
- **Files modified:** 6 across `qc-backend` and `qc-dashboard`

## Accomplishments

- `qc-dashboard` `assets.publicVerify` now normalizes `blockchain` from asset data or metadata and returns it both at top-level and inside `asset`.
- The dashboard server test covers Stellar proof propagation, Solana/future-chain propagation, `blockchain:null`, and local/demo fallback when backend-QC fails.
- `VerifyAsset.tsx` now normalizes `result.blockchain ?? result.asset.blockchain ?? null` and renders a generic `Verificação Blockchain` card when `chain` and `dltTxId` exist.
- The UI uses `ShieldCheck` and `ExternalLink`, displays the chain and transaction id, and opens `explorerUrl` only when backend sends it.
- Created `03-HUMAN-UAT.md` with the Stellar txId, Stellar Expert URL, contract id, EventLog, ChainTransaction, screenshot/note, and `get_anchor_hash` evidence fields.
- ROADMAP/REQUIREMENTS explicitly preserve `DLT-02` Solana and `DLT-05` persisted `lastScannedBlock` as deferred backlog items.

## Task Commits

1. **Dashboard blockchain proof card** - `e0cbd44` in `qc-dashboard` (`feat(03-03)`)
2. **Stellar UAT checklist and scope notes** - `5ce5608` in `qc-backend` (`docs(03-03)`)

## Files Created/Modified

- `../qc-dashboard/server/routers.ts` - normalizes and propagates generic `blockchain` proof.
- `../qc-dashboard/server/verify.asset.test.ts` - adds cross-chain proof and fallback regression coverage.
- `../qc-dashboard/client/src/pages/VerifyAsset.tsx` - renders the public blockchain proof card.
- `.planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-HUMAN-UAT.md` - tracks manual Stellar evidence.
- `.planning/ROADMAP.md` - records execution note and deferred scope.
- `.planning/REQUIREMENTS.md` - keeps `DLT-02` and `DLT-05` open and explicitly deferred from this hackathon slice.

## Decisions Made

- Dashboard proof display is chain-agnostic; Stellar is the current UAT target, not a rendering condition.
- Public verification remains demo-safe: failed backend-QC proof lookups do not break local/demo asset verification.
- Phase 3 cannot be marked human-accepted until `03-HUMAN-UAT.md` is filled with real Stellar testnet evidence.

## Deviations from Plan

- `../qc-dashboard/server/services/qcBackendClient.ts` did not require changes; the existing client already passes backend payloads through.

## Issues Encountered

Manual Stellar testnet evidence is pending and must be completed by a human/operator with access to the deployed/testnet environment.

## Verification

- `cd ../qc-dashboard && npx vitest run server/verify.asset.test.ts` - 11 passed
- `cd ../qc-dashboard && npm run build` - passed
- `grep -c "blockchain" ../qc-dashboard/server/routers.ts` - passed
- `grep -c "STELLAR" ../qc-dashboard/server/verify.asset.test.ts` - passed
- `grep -c "Verificação Blockchain" ../qc-dashboard/client/src/pages/VerifyAsset.tsx` - passed
- `grep -c "blockchain?.chain === 'STELLAR'" ../qc-dashboard/client/src/pages/VerifyAsset.tsx` - 0
- `grep -c "verificationData.blockchain" ../qc-dashboard/client/src/pages/VerifyAsset.tsx` - passed
- `grep -c "Stellar txId" .planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-HUMAN-UAT.md` - passed
- `grep -c "get_anchor_hash" .planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-HUMAN-UAT.md` - passed
- `git diff --check` in `qc-dashboard` and `qc-backend` - passed

## User Setup Required

Fill `03-HUMAN-UAT.md` after running real Stellar testnet provisioning, anchor processing, document verification, and dashboard inspection.

## Next Phase Readiness

Implementation is ready for final Phase 3 verification, but shipping remains blocked on manual Stellar UAT evidence.

## Self-Check: PASSED_WITH_PENDING_HUMAN_UAT

---
*Phase: 03-pluggable-dlt-workers-stellar-soroban-priority*
*Completed: 2026-05-14*
