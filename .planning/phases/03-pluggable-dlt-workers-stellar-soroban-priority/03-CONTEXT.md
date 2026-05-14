# Phase 3: Pluggable DLT Workers - Stellar/Soroban Priority - Context

**Gathered:** 2026-05-13
**Status:** Ready for execution
**Source:** `03-SPEC.md` plus codebase scout, implementation discussion, and post-plan scope reconciliation

<domain>
## Phase Boundary

This phase delivers the Stellar hackathon slice of pluggable DLT workers: a real Stellar/Soroban anchoring path for approved `EventLog` records, a demo tenant that routes anchoring to Stellar, and public verification proof fields that can show a Stellar transaction. It must remain Stellar-first, not Stellar-only: the queue, adapter interface, transaction persistence, public proof shape, and dashboard proof card should stay reusable for every chain. It also includes the dashboard proof card because the phase acceptance criteria require the external judge to see the Stellar proof in `/verify`. Micropayment/x402 support is a nice-to-have hook only, disabled by default through env config.

</domain>

<spec_lock>

## Requirements (locked via SPEC.md)

**5 requirements are locked and 1 requirement is nice-to-have.** See `03-SPEC.md` for full requirements, boundaries, constraints, and acceptance criteria.

Downstream agents MUST read `03-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**

- Soroban contract build/deploy to Stellar testnet and verification through Stellar Explorer/Stellar Expert.
- `src/scripts/provision-stellar.ts` to create/read a Stellar authority keypair, fund testnet account, and print required env values.
- Demo tenant with `targetChain = STELLAR` so `AnchorQueueService` routes approved events to `SorobanAdapter`.
- Backend public verification response extended with `blockchain: { dltTxId, explorerUrl, chain, anchoredAt } | null`.
- Dashboard `/verify` renders a generic "Verificação Blockchain" proof card for any chain; Stellar Expert link is the current UAT case.
- Optional payment/x402 hook on `GET /api/v1/public/verify/document/{hash}`, disabled by default via env var.

**Out of scope (from SPEC.md):**

- Solana adapter implementation in this hackathon slice. `DLT-02` remains backlog v1, but is not an acceptance gate for the current Stellar execution.
- Persisted `lastScannedBlock` implementation in this slice. `DLT-05` remains backlog v1, but is not an acceptance gate for the current Stellar execution.
- Mainnet deployment, contract audit, broad multi-chain refactor, and Ethereum/Polygon changes.

</spec_lock>

<decisions>
## Implementation Decisions

### Scope Reconciliation

- **D-01:** `03-SPEC.md` is the source of truth for Phase 3 execution. The plan must prioritize the hackathon-critical Stellar/Soroban proof slice. x402/micropayments are not a blocker.
- **D-02:** `DLT-02` Solana and `DLT-05` persisted `lastScannedBlock` are intentionally deferred for this slice. Plans may record the deferral but must not silently expand scope beyond the SPEC deadline.
- **D-03:** The plan may include a planning/docs task to reconcile roadmap wording after execution, but code work should not implement Solana or observer persistence unless the spec is changed first.
- **D-20:** Phase execution may be cross-repo. `qc-backend` owns API and DLT contracts, `qc-dashboard` owns the verification UI, `qc-record-module` owns physical QTAG write/scan flows, `qc-home` owns public web journeys, and `qc-business` owns business/product decisions.
- **D-21:** Stellar is the only chain implemented in this hackathon slice, but the implementation must remain Solana-ready. Core flow should use `tenant.targetChain -> DLTAdapterFactory -> IDLTAdapter`, persist the resulting `ChainTransaction.chain`, and expose generic `blockchain` proof fields. Chain-specific logic belongs in adapters, provisioning scripts, and explorer URL mapping.

### Stellar/Soroban Anchoring

- **D-04:** Use the existing `contracts/soroban/payment` contract as the anchor contract; do not redesign escrow/payment behavior in this phase.
- **D-05:** `SorobanAdapter.anchorEvent()` must preserve tenant ownership in `ChainTransaction`; the current `tenantId: 'SYSTEM'` behavior is not acceptable for Phase 3 success.
- **D-06:** `AnchorQueueService` remains the routing source of truth. It should keep using `tenant.targetChain` and must leave Algorand behavior unchanged.
- **D-06A:** The selected chain for an event is atomic. Once `AnchorQueueService` locks an `EventLog`, it must resolve one target chain for that tenant, call one adapter, and persist metadata for that same chain; no implicit fallback to a different chain on partial failure.
- **D-07:** Testnet env defaults must use Stellar testnet values. Mainnet values are documentation-only until a later release.

### Provisioning and Demo Tenant

- **D-08:** `src/scripts/provision-stellar.ts` should be idempotent: reuse an existing secret when provided, generate one only when missing, fund via Friendbot on testnet, and print copy/paste env output without committing secrets.
- **D-09:** Demo tenant provisioning should be scriptable enough for UAT: create or update a tenant with `targetChain = STELLAR`, generate/print a usable API key when needed, and avoid leaking secrets in tracked files.

### Public Verification Contract

- **D-10:** Keep Phase 2's flat document verification fields for backward compatibility, but add a nested `blockchain` object for new consumers and dashboard rendering.
- **D-11:** `blockchain` is `null` until an anchor transaction exists. When present, it contains `dltTxId`, `explorerUrl`, `chain`, and `anchoredAt`.
- **D-12:** Explorer URLs are generated server-side so clients do not need chain-specific URL rules.

### x402

- **D-13:** x402/micropayment is a nice-to-have hook, not a must-have. The default behavior is disabled/free through env config such as `X402_ENABLED=false`.
- **D-14:** If enabled in the future, payment gating applies only to `GET /api/v1/public/verify/document/{hash}`. It must not gate `/api/v1/scan`, Diamond routes, asset public verification, or dashboard auth routes.
- **D-15:** The route remains public/no API key and free by default. Missing payment must not block verification unless an operator explicitly enables payment mode.
- **D-16:** Do not lock the product to USDC or a specific x402 package in this phase. Preferred commercial direction is an Anchor-based integration with a BRZ/Real Brasileiro pair, with Transfero as an example candidate to evaluate later; the final business decision belongs in `qc-business`.

### Dashboard

- **D-17:** Include the sibling `qc-dashboard` verification card in this phase because it is part of the locked acceptance criteria.
- **D-18:** The dashboard should render proof for any chain when backend data includes `blockchain.chain` and `blockchain.dltTxId`; no fake proof for unanchored records.
- **D-18A:** Do not gate dashboard proof on `blockchain.chain === 'STELLAR'`. The current UAT uses Stellar, but future Solana/Algorand proofs must render through the same card. The explorer link is conditional on `blockchain.explorerUrl`.
- **D-19:** The dashboard integration should keep existing local/demo fallback behavior working when `qc-backend` is unavailable.

### Agent Discretion

- Planner may choose exact plan split, test file split, and whether to add helper modules for optional payment gating/explorer URL generation.
- Planner should keep changes narrow and prefer existing adapters, Prisma models, public route patterns, and dashboard `publicVerify` flow.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope

- `.planning/phases/03-pluggable-dlt-workers-stellar-soroban-priority/03-SPEC.md` — locked Phase 3 requirements, acceptance criteria, deadline, and scope exceptions.
- `.planning/ROADMAP.md` — Phase 3 roadmap entry, issue #11, current 3-plan execution split, and explicit `DLT-02`/`DLT-05` deferral for this slice.
- `.planning/REQUIREMENTS.md` — `DLT-01` through `DLT-05`; `DLT-02` and `DLT-05` remain backlog items but are not acceptance gates for this Stellar hackathon slice.
- `.planning/PROJECT.md` — Golden Rule, multi-tenant boundaries, and Stellar hackathon priority.
- `.planning/STATE.md` — prior phase state and dependency context.

### Backend Code

- `src/services/multi-chain/SorobanAdapter.ts` — existing Stellar/Soroban adapter and current `tenantId: 'SYSTEM'` logging gap.
- `contracts/soroban/payment/src/lib.rs` — existing `anchor_event` and `get_anchor_hash` contract functions.
- `src/services/AnchorQueueService.ts` — queue locking and `tenant.targetChain` routing.
- `src/services/DLTAdapterFactory.ts` — current `STELLAR -> SorobanAdapter` routing.
- `src/services/core-facets/DocumentVerificationFacet.ts` — Phase 2 document verification response and ChainTransaction lookup.
- `src/routes/v1/publicRoutes.ts` — public document verification route and OpenAPI docs.
- `src/services/KMSService.ts` — Stellar env key retrieval patterns.
- `prisma/schema.prisma` — `Tenant.targetChain`, `EventLog`, `ChainTransaction`, and related indexes.
- `tests/multi-chain/soroban-adapter.test.ts` — current Soroban adapter unit coverage and mocks.
- `tests/document-verification.test.ts` — Phase 2 public verification regression coverage.

### Dashboard Code

- `../qc-dashboard/server/routers.ts` — `assets.publicVerify` and `verify.document` tRPC routes.
- `../qc-dashboard/server/services/qcBackendClient.ts` — backend-QC raw GET and Diamond client.
- `../qc-dashboard/client/src/pages/VerifyAsset.tsx` — public verification page that must render the generic blockchain proof.
- `../qc-dashboard/server/verify.asset.test.ts` — dashboard public verification test surface.

### External References

- `https://developers.stellar.org/docs/build/agentic-payments/x402` — reference only for future optional x402 evaluation.
- `https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide` — reference only if `X402_ENABLED` graduates from hook to concrete implementation.
- `https://stellar.org/x402` — product-level reference for future public/API monetization.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `SorobanAdapter` already implements `IDLTAdapter` and calls Soroban `anchor_event`.
- `DLTAdapterFactory.getAdapter('STELLAR')` already returns `SorobanAdapter`.
- `AnchorQueueService.processQueue()` already groups locked events by `tenant.targetChain`.
- `DocumentVerificationFacet.verifyByHash()` already looks up the latest `ChainTransaction` for `txRef = EventLog.id`.
- `publicRoutes.ts` already owns `GET /api/v1/public/verify/document/:hash`.
- `qc-dashboard` already proxies backend document verification via `verify.document` and asset public verification via `assets.publicVerify`.

### Established Patterns

- Backend mutations and tenant-scoped reads use Diamond/facets; public routes stay in `src/routes/v1/publicRoutes.ts`.
- Tenant identity must come from stored tenant/API-key context, not request body.
- ChainTransaction records must include `tenantId` for isolation and billing.
- Chain selection must be persisted through `ChainTransaction.chain` and exposed through generic proof fields, not inferred from Stellar-specific response names or UI filters.
- Public verification payloads must avoid sensitive fields and preserve backward compatibility.
- Dashboard public verification must keep local/demo fallback paths alive when backend-QC is unreachable.

### Integration Points

- Stellar provisioning touches `src/scripts/provision-stellar.ts`, `.env.example`, `KMSService`, and possibly seed/demo tenant scripts.
- Stellar anchoring touches `SorobanAdapter`, `AnchorQueueService`, `DLTAdapterFactory`, `ChainTransaction`, and adapter tests.
- Multi-chain flexibility must be protected in the same files: adding Solana later should mean adding/plugging a Solana adapter and explorer mapping, not rewriting `AnchorQueueService` or public verification contracts.
- Public proof and optional payment hook touch `publicRoutes.ts`, `DocumentVerificationFacet`, OpenAPI docs, env config, and document verification tests.
- Dashboard proof display touches `server/routers.ts`, `server/services/qcBackendClient.ts`, and `client/src/pages/VerifyAsset.tsx` in the sibling repo.

</code_context>

<specifics>
## Specific Ideas

- Use `X402_ENABLED=false` as the default UAT posture.
- Use Stellar Expert links for the current Stellar transaction proof, but keep the dashboard card generic for every chain.
- Use "Verificação Blockchain" as the visible card title; render the chain value from `blockchain.chain`.
- Keep labels generic (`blockchain.chain`, `dltTxId`, `explorerUrl`) and avoid a `chain === STELLAR` display gate.
- Avoid committing generated Stellar secret keys or test API keys.
- Treat micropayment/x402 as future monetization: commercially interesting, but not required to close Phase 3. Preferred future path is Anchor/BRZ, for example Transfero.

</specifics>

<deferred>
## Deferred Ideas

- Implement Solana adapter (`DLT-02`) in a later non-hackathon phase.
- Add Solana by implementing the adapter/provisioning/explorer mapping against the existing multi-chain seams, not by reworking queue or verification contracts.
- Implement persisted observer/checkpoint state for `lastScannedBlock` (`DLT-05`) in a later scale/worker reliability pass.
- Mainnet Stellar deployment and contract audit.
- Define and implement the actual micropayment provider, likely via Anchor/BRZ, after product and compliance decisions.
- Broader x402/commercialization across more public endpoints.

</deferred>

---

_Phase: 03-pluggable-dlt-workers-stellar-soroban-priority_
_Context gathered: 2026-05-13_
