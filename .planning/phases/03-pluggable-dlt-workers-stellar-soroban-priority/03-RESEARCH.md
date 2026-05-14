# Phase 3: Pluggable DLT Workers - Stellar/Soroban Priority - Research

**Date:** 2026-05-13
**Status:** Complete
**Question:** What do we need to know to plan the Stellar/Soroban hackathon slice well?

## Research Complete

Phase 3 can be planned as a narrow vertical slice: deploy/provision Stellar testnet anchoring, route one tenant through the existing queue to `SorobanAdapter`, expose the resulting proof publicly, and render it in `qc-dashboard`. The main planning risk is scope drift: Solana and persisted `lastScannedBlock` remain backlog v1 requirements, but the current Stellar hackathon slice intentionally defers both and must not count them as acceptance gates.

## Key Findings

### Stellar/Soroban Anchoring

- The repo already has the core adapter path: `DLTAdapterFactory.getAdapter('STELLAR')` returns `SorobanAdapter`, and `AnchorQueueService` groups approved events by `tenant.targetChain`.
- `SorobanAdapter.anchorEvent()` already calls `anchor_event` on the configured contract, but it logs `ChainTransaction` with `tenantId: 'SYSTEM'`. This conflicts with the Phase 3 success criterion that tenant queries on `ChainTransaction` remain isolated by real `tenantId`.
- The contract `contracts/soroban/payment/src/lib.rs` already exposes `anchor_event(env, event_id, hash, unlock_timestamp)` and `get_anchor_hash(env, event_id)`. Planning should treat this contract as fixed unless compilation/deploy proves a small signature mismatch.
- The current adapter pads 32-byte hashes to 64 bytes and accepts 64-byte SHA3-512 hashes directly. Phase 3 document verification uses SHA3-512, so the happy path should pass 64 bytes.

### Provisioning

- There is no `src/scripts/provision-stellar.ts` yet.
- `.env.example` currently uses public network defaults:
  - `STELLAR_HORIZON_URL="https://horizon.stellar.org"`
  - `STELLAR_SOROBAN_RPC_URL="https://soroban-rpc.stellar.org"`
  - `STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"`
- The hackathon path needs testnet defaults:
  - Horizon: `https://horizon-testnet.stellar.org`
  - Soroban RPC: `https://soroban-testnet.stellar.org`
  - Network passphrase: `Test SDF Network ; September 2015`
- The provisioning script should be idempotent and fail loudly if Soroban CLI/toolchain is unavailable, instead of silently writing fake contract IDs.

### Optional x402 / Micropayment Hook

- x402 is useful background for future public API monetization, but it is not a must-have for Phase 3. The product decision on micropayments remains open.
- The route `GET /api/v1/public/verify/document/{hash}` should stay free by default. Any payment behavior must be opt-in through env config such as `X402_ENABLED=false`.
- Do not assume USDC as the final settlement asset for Quantum Cert. The preferred commercial direction is to evaluate an Anchor that operates a Real Brasileiro pair, for example BRZ via Transfero.
- If x402 is later selected, current Stellar docs describe an HTTP 402 payment flow using Soroban authorization entries. The official quickstart currently installs `@x402/core`, `@x402/express`, `@x402/fetch`, and `@x402/stellar`, but package selection should be revisited when the product decision is made.
- Planning should implement only a safe hook/no-op gate in this phase, not a mandatory paid verification flow.

Sources:

- https://developers.stellar.org/docs/build/agentic-payments/x402
- https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide
- https://stellar.org/x402

### Public Verification Contract

- Phase 2 implemented `GET /api/v1/public/verify/document/:hash` with flat proof fields and structured `400`/`404` errors.
- `DocumentVerificationFacet.verifyByHash()` already does the key lookup:
  - `EventLog.documentHash`
  - latest `ChainTransaction` where `txRef = event.id` and `direction = 'ANCHOR'`
- Phase 3 should add `blockchain` without removing the Phase 2 flat fields. This avoids breaking existing clients and lets dashboard adopt the nested object.
- `explorerUrl` should be created by backend to centralize chain-specific URL formats.

### Dashboard Integration

- `qc-dashboard` public asset verification currently uses `assets.publicVerify` in `server/routers.ts`, which delegates asset lookup to backend-QC and records public scan events.
- The page `client/src/pages/VerifyAsset.tsx` maps server response into a local `verificationData` object and renders status, image, details, and public contribution UI.
- The dashboard already has a `verify.document` tRPC route that calls backend `GET /api/v1/public/verify/document/{hash}`. For the public `/verify` page badge, the likely path is extending `assets.publicVerify` to surface backend `blockchain` proof from asset/event data rather than only document hashes.
- Dashboard must keep its local demo fallback. A failed backend call should not break existing demo presentation flows.

## Validation Architecture

### Dimensions

1. **Soroban deploy/provisioning:** `src/scripts/provision-stellar.ts` can produce or reuse testnet authority credentials, fund the account, and output `STELLAR_*` env values.
2. **Tenant routing:** A tenant with `targetChain = STELLAR` routes `AnchorQueueService` work to `SorobanAdapter`.
3. **Tenant isolation:** Stellar `ChainTransaction` records store the real `tenantId`, not `SYSTEM`.
4. **Algorand regression:** A tenant with `targetChain = ALGORAND` continues to anchor through existing Algorand behavior.
5. **Public proof:** Document verification returns both backward-compatible flat fields and `blockchain` object when a transaction exists.
6. **Optional payment hook:** With `X402_ENABLED=false` or env absent, document verification remains free and returns the normal proof. If an experimental payment mode is enabled, it must be route-scoped and must not affect `/api/v1/scan`.
7. **Dashboard proof:** `VerifyAsset.tsx` renders a generic blockchain proof card for any chain when response data contains `blockchain.chain` and `blockchain.dltTxId`. The current UAT proves Stellar with a Stellar Expert link, but the component must not filter on `blockchain.chain === 'STELLAR'`; future Solana/Algorand proofs should render through the same card, with the explorer link shown only when `blockchain.explorerUrl` is present.
8. **UAT proof:** A human-readable UAT script must capture a Stellar tx hash, explorer URL, and proof that `get_anchor_hash` returns the anchored event hash.

### Recommended Test Split

- Backend unit/integration:
  - `tests/multi-chain/soroban-adapter.test.ts`
  - `tests/anchor-queue-stellar.test.ts` or equivalent new queue test
  - `tests/document-verification.test.ts`
  - `tests/document-payment-gate.test.ts` or route-level extension for the disabled-by-default payment hook
- Scripts:
  - `tests/provision-stellar.test.ts` with network calls mocked
- Dashboard:
  - `../qc-dashboard/server/verify.asset.test.ts`
  - `../qc-dashboard/client/src/pages/VerifyAsset.tsx` component-level or route smoke coverage if existing harness supports it

### Manual UAT

- Run `src/scripts/provision-stellar.ts` against Stellar testnet.
- Set printed `STELLAR_*` env vars.
- Create/update demo tenant with `targetChain = STELLAR`.
- Create an asset/event for that tenant, run `AnchorQueueService.processQueue()`, and confirm:
  - `EventLog.dltTxId` is a Stellar tx hash.
  - `ChainTransaction.chain = STELLAR`.
  - `ChainTransaction.tenantId` equals the demo tenant.
  - Public document verification returns `blockchain.explorerUrl`.
  - Dashboard `/public/verify/{id}` shows a generic blockchain proof card; in the current Stellar UAT it includes the Stellar Expert link.

## Planning Guidance

- Do not plan Solana implementation or persisted `lastScannedBlock` unless the user updates `03-SPEC.md`.
- Even while Solana is deferred, preserve the existing multi-chain seams: `tenant.targetChain`, `DLTAdapterFactory`, `IDLTAdapter`, `ChainTransaction.chain`, and generic `blockchain` response fields. Stellar-specific behavior belongs in the Stellar adapter/provisioning/explorer mapping.
- Make the first plan establish real Stellar anchoring and tenant-safe logging. Everything else depends on this proof path.
- Put the optional payment hook after public verification proof shape, because it should wrap the final route contract and stay disabled by default.
- Put dashboard after backend proof shape, because the UI needs stable `blockchain` fields.
- Keep all secret material out of tracked artifacts and logs.
