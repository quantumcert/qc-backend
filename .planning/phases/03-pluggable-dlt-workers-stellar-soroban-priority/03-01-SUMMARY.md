---
phase: 03-pluggable-dlt-workers-stellar-soroban-priority
plan: 01
subsystem: dlt-workers
tags: [stellar, soroban, anchor-queue, tenant-isolation, provisioning]
requires:
  - phase: 01-core-gap-closure-production-hardening
    provides: ChainTransaction logging base, KMSService, DLTAdapterFactory
provides:
  - Tenant-safe Stellar/Soroban anchoring through SorobanAdapter
  - AnchorQueueService routing by tenant.targetChain with tenantId propagation
  - Idempotent Stellar testnet provisioning script with Friendbot and CLI checks
affects: [phase-3, dlt-workers, stellar-testnet, multi-chain]
tech-stack:
  added: []
  patterns: [tenant-safe-anchor-logging, chain-agnostic-worker-routing, env-only-provisioning]
key-files:
  created:
    - src/scripts/provision-stellar.ts
    - tests/anchor-queue-stellar.test.ts
    - tests/provision-stellar.test.ts
  modified:
    - src/interfaces/IDLTAdapter.ts
    - src/services/multi-chain/SorobanAdapter.ts
    - src/services/AnchorQueueService.ts
    - tests/multi-chain/soroban-adapter.test.ts
    - package.json
    - .env.example
key-decisions:
  - "Stellar anchorEvent now requires tenantId; missing tenant context fails before submitting a chain transaction."
  - "AnchorQueueService keeps routing through tenant.targetChain and passes event.tenantId into the adapter contract."
  - "provision:stellar prints copy/paste env values to stdout only; it does not write secrets into tracked files."
requirements-completed: [DLT-01, DLT-03, DLT-04]
duration: 12 min
completed: 2026-05-14
---

# Phase 03 Plan 01: Stellar/Soroban Provisioning + Tenant-Safe Anchoring Summary

**Stellar-first anchoring path with tenant-safe transaction logging, chain-agnostic queue routing, and testnet provisioning.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-14T02:43:00Z
- **Completed:** 2026-05-14T02:55:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- `SorobanAdapter.anchorEvent()` now requires `options.tenantId` and stores that tenant on `ChainTransaction` for Stellar anchor logs.
- `AnchorQueueService.processQueue()` passes `event.tenantId` into adapter anchoring and continues selecting adapters through the tenant `targetChain`, preserving Algorand behavior.
- Added `npm run provision:stellar` via `src/scripts/provision-stellar.ts`.
- The provisioning script reuses an existing `STELLAR_AUTHORITY_SECRET_KEY` or generates a testnet keypair, funds generated accounts with Friendbot, checks the Stellar/Soroban CLI, builds the existing Soroban contract, deploys when no real contract id exists, and prints the required `STELLAR_*` env vars.
- `.env.example` now defaults Stellar/Soroban values to testnet endpoints and passphrase.
- Added focused regression tests for Stellar queue routing and provisioning behavior.

## Task Commits

1. **Require tenant context for Stellar anchors** - `f04a24e` (`feat(03-01)`)
2. **Route Stellar anchors with tenant context** - `b51fb12` (`feat(03-01)`)
3. **Add Stellar provisioning script** - `e68ee33` (`feat(03-01)`)

## Files Created/Modified

- `src/interfaces/IDLTAdapter.ts` - adds optional `tenantId` to `AnchorOptions`.
- `src/services/multi-chain/SorobanAdapter.ts` - enforces tenant context for anchors and logs Stellar `ChainTransaction` rows with the real tenant.
- `src/services/AnchorQueueService.ts` - routes by `tenant.targetChain` and passes `tenantId` into adapter anchor options.
- `src/scripts/provision-stellar.ts` - adds the testable provisioning entrypoint and CLI/Friendbot/deploy flow.
- `tests/multi-chain/soroban-adapter.test.ts` - covers tenant-safe Stellar anchor logging and missing tenant rejection.
- `tests/anchor-queue-stellar.test.ts` - covers STELLAR routing, ALGORAND regression, and retry context.
- `tests/provision-stellar.test.ts` - covers existing secret reuse, generated testnet funding, env output, and missing CLI failure.
- `package.json` - adds `provision:stellar`.
- `.env.example` - switches Stellar defaults to testnet.

## Decisions Made

- `tenantId` is enforced at the Stellar anchor boundary because a submitted chain transaction without tenant context would create an unverifiable multi-tenant audit row.
- Provisioning remains operator-driven and env-only; secrets are printed for secure storage but never persisted by the script.
- Existing non-anchor Stellar methods keep their legacy system-level logging behavior outside this plan; this plan locks the anchor proof path required for Phase 3.

## Deviations from Plan

- `package-lock.json` was not modified because no dependency changed; adding an npm script does not require a lockfile update.

## Issues Encountered

None.

## Verification

- `grep -c "tenantId?: string" src/interfaces/IDLTAdapter.ts` - passed
- `grep -c "tenantId: event.tenantId" src/services/AnchorQueueService.ts` - passed
- `grep -c "getAdapter(tenant.targetChain" src/services/AnchorQueueService.ts` - passed
- `grep -c "provision:stellar" package.json` - passed
- `grep -c "horizon-testnet.stellar.org" .env.example` - passed
- `npx vitest run tests/multi-chain/soroban-adapter.test.ts` - 10 passed
- `npx vitest run tests/anchor-queue-stellar.test.ts tests/anchor-queue-skip-locked.test.ts` - 7 passed
- `npx vitest run tests/provision-stellar.test.ts` - 4 passed
- `npx vitest run tests/multi-chain/soroban-adapter.test.ts tests/anchor-queue-stellar.test.ts tests/provision-stellar.test.ts` - 17 passed
- `npm run build` - passed

## User Setup Required

- Install the Stellar/Soroban CLI before running `npm run provision:stellar`.
- Store generated `STELLAR_AUTHORITY_SECRET_KEY` in local secrets or deployment secrets, never in tracked files.
- Copy the printed `STELLAR_ANCHOR_CONTRACT_ID` and testnet endpoint values into the runtime environment.

## Next Phase Readiness

Ready for Plan 03-02: public document verification can now expose blockchain proof metadata backed by tenant-safe Stellar anchor logs.

## Self-Check: PASSED

---
*Phase: 03-pluggable-dlt-workers-stellar-soroban-priority*
*Completed: 2026-05-14*
