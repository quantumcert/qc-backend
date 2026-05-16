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
  - "Human Stellar testnet evidence was required before shipping and is now recorded in 03-HUMAN-UAT.md."
requirements-completed: [DLT-01, DLT-03, DLT-04]
duration: 5 min
completed: 2026-05-14
---

# Phase 03 Plan 03: Dashboard Proof Card + UAT Summary

**qc-dashboard now propagates and renders generic blockchain proof, with Stellar testnet UAT completed and recorded.**

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
- Created and completed `03-HUMAN-UAT.md` with the Stellar txId, Stellar Expert URL, contract id, EventLog, ChainTransaction, screenshot/note, and `get_anchor_hash` evidence fields.
- ROADMAP/REQUIREMENTS explicitly preserve `DLT-02` Solana and `DLT-05` persisted `lastScannedBlock` as deferred backlog items.

## Task Commits

1. **Dashboard blockchain proof card** - `e0cbd44` in `qc-dashboard` (`feat(03-03)`)
2. **Stellar UAT checklist and scope notes** - `5ce5608` in `qc-backend` (`docs(03-03)`)

## Files Created/Modified

- `../qc-dashboard/server/routers.ts` - normalizes and propagates generic `blockchain` proof.
- `../qc-dashboard/server/verify.asset.test.ts` - adds cross-chain proof, UUID lookup, and fallback regression coverage.
- `../qc-dashboard/client/src/pages/VerifyAsset.tsx` - renders the public blockchain proof card.
- `.planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-HUMAN-UAT.md` - tracks manual Stellar evidence.
- `.planning/ROADMAP.md` - records execution note and deferred scope.
- `.planning/REQUIREMENTS.md` - keeps `DLT-02` and `DLT-05` open and explicitly deferred from this hackathon slice.

## Decisions Made

- Dashboard proof display is chain-agnostic; Stellar is the current UAT target, not a rendering condition.
- Public verification remains demo-safe: failed backend-QC proof lookups do not break local/demo asset verification.
- Phase 3 is human-accepted for the Stellar/Soroban hackathon slice after `03-HUMAN-UAT.md` captured real Stellar testnet evidence.

## Deviations from Plan

- `../qc-dashboard/server/services/qcBackendClient.ts` did not require changes; the existing client already passes backend payloads through.

## Issues Encountered

Manual Stellar testnet evidence was completed by a human/operator with access to the local testnet/UAT environment.

## Verification

- `cd ../qc-dashboard && npx vitest run server/verify.asset.test.ts` - 12 passed
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

No remaining user setup is required to accept the Stellar/Soroban hackathon slice. Future production deployment still requires real deployment secrets and operator-controlled Stellar env vars.

## Next Phase Readiness

Implementation passed final Phase 3 verification and was shipped for review through the backend/dashboard PRs.

## Self-Check: PASSED

---
*Phase: 03-pluggable-dlt-workers-stellar-soroban-priority*
*Completed: 2026-05-14*
