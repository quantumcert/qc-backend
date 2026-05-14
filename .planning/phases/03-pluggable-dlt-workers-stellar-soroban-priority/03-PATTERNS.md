# Phase 3: Pluggable DLT Workers - Stellar/Soroban Priority - Patterns

**Date:** 2026-05-13
**Status:** Complete

## Existing Analogs

| New/Changed Area               | Closest Existing Analog                                                                            | Pattern to Reuse                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Stellar adapter tenant logging | `src/services/core-facets/AlgorandAnchorFacet.ts` and `src/services/multi-chain/SorobanAdapter.ts` | Anchor returns a tx id, then records `ChainTransaction` with `tenantId`, `txRef`, `chain`, `direction`, `status`, and `metadata`. |
| Tenant chain routing           | `src/services/AnchorQueueService.ts`                                                               | Fetch tenants once, map `tenantId -> targetChain`, group locked events by chain, call `DLTAdapterFactory.getAdapter(chain)`.      |
| Public document route          | `src/routes/v1/publicRoutes.ts`                                                                    | Route-local validation maps domain failures to structured HTTP errors and OpenAPI docs live beside handler.                       |
| Document proof lookup          | `src/services/core-facets/DocumentVerificationFacet.ts`                                            | Lookup by `EventLog.documentHash`, then latest `ChainTransaction` by `txRef = EventLog.id`, `direction = 'ANCHOR'`.               |
| Optional payment hook boundary | Express middleware chain in `src/routes/v1/publicRoutes.ts` and `src/server.ts`                    | Keep payment hook route-scoped and disabled by default. Do not apply payment gate globally.                                       |
| Dashboard backend client       | `../qc-dashboard/server/services/qcBackendClient.ts`                                               | Use `rawGet()` for public backend routes and Diamond `call()` for authenticated selectors.                                        |
| Dashboard public verify page   | `../qc-dashboard/client/src/pages/VerifyAsset.tsx`                                                 | Map tRPC response into `verificationData`, then render conditional UI from that normalized object.                                |

## Reusable Code Contracts

### `IDLTAdapter.anchorEvent`

Current signature:

```typescript
anchorEvent(eventId: string, hash: string, options?: AnchorOptions): Promise<string>
```

Phase 3 needs tenant-safe logging. Preferred approaches:

1. Extend `AnchorOptions` with `tenantId?: string` and pass it from `AnchorQueueService`.
2. If changing adapter interface is too broad, move `ChainTransaction` logging to `AnchorQueueService` after adapter returns `txId`.

The plan should prefer the smallest change that prevents duplicate/incorrect `ChainTransaction` entries. If adapter logging remains, `SorobanAdapter` must not write `tenantId: 'SYSTEM'`.

### Public Verification Response

Current flat response fields should remain:

```typescript
{
  verified: true;
  assetId: string;
  assetStatus: string;
  publicUrl?: string | null;
  dltTxId?: string | null;
  chain?: string;
  anchoredAt?: Date;
  eventId?: string;
  issuerId?: string | null;
  confirmationStatus?: string;
}
```

Phase 3 addition:

```typescript
blockchain: {
  dltTxId: string;
  explorerUrl: string | null;
  chain: 'STELLAR' | 'ALGORAND' | string;
  anchoredAt: Date | string;
} | null;
```

### Chain Selection Atomicity

The current implementation target is Stellar, but the core path must remain chain-neutral:

1. Resolve `tenant.targetChain` once for the locked event batch.
2. Call `DLTAdapterFactory.getAdapter(chain)` with that value.
3. Call the selected adapter through `IDLTAdapter`.
4. Persist the same chain in `ChainTransaction.chain`.
5. Expose the same chain through `blockchain.chain`.

Do not add Stellar-only branches to `AnchorQueueService`, `DocumentVerificationFacet`, dashboard rendering, or public response field names. Adding Solana later should require a Solana adapter, env/provisioning, and explorer mapping, not a rewrite of queue routing, verification contracts, or UI proof cards.

### Optional Payment Hook Pattern

Phase 3 should not require a live x402 provider. Use a local helper such as `src/middleware/documentPaymentGate.ts` with this behavior:

```typescript
export function createDocumentPaymentGate(): express.RequestHandler {
  if (process.env.X402_ENABLED !== "true") return (_req, _res, next) => next();
  // Future provider branch: x402/Anchor integration.
}
```

The helper name can stay generic because the preferred future product direction is not locked to x402/USDC. Document the future provider decision as Anchor/BRZ, with Transfero as an example candidate to evaluate.

## Integration Constraints

- `publicRoutes.ts` is mounted under `/api/v1/public`; route-local path remains `/verify/document/:hash`.
- `AnchorQueueService` must leave the Algorand branch unchanged. Add regression tests around chain grouping rather than editing Algorand adapter behavior.
- `AnchorQueueService` must also avoid Stellar-only shortcuts. Chain-specific behavior belongs in adapters and helpers, while the queue operates on `targetChain`.
- `KMSService` already maps Stellar `rpcUrl` to `STELLAR_HORIZON_URL` and `secretKey` to `STELLAR_AUTHORITY_SECRET_KEY`.
- `@stellar/stellar-sdk` is mocked in tests through `__mocks__/@stellar/stellar-sdk.ts`; extend this mock instead of making real network calls.
- `qc-dashboard` may be unavailable from backend tests. Keep backend plans independent and dashboard plans explicit about sibling repo paths.
- `qc-dashboard` proof rendering must key off generic `blockchain.chain` + `blockchain.dltTxId`; `explorerUrl` controls only whether the external link is shown.

## Landmines

- Do not install or require x402 packages as a must-have. Micropayment provider selection is open and should account for Anchor/BRZ.
- `SorobanAdapter.anchorEvent()` currently logs a `ChainTransaction` itself with `tenantId: 'SYSTEM'`; leaving this unchanged will fail tenant isolation.
- `DocumentVerificationFacet` currently returns `chain` as undefined if no `ChainTransaction` exists. `blockchain` must be `null` in that case, not a partially populated object.
- `qc-dashboard` `VerifyAsset.tsx` currently stores only selected asset fields in `verificationData`; add `blockchain` during normalization or the UI will never see the proof.
- Payment hook tests should verify disabled-by-default behavior. Any enabled-provider behavior is nice-to-have and must not fake settlement.
- Hardcoding Stellar into core response field names or queue logic will make the later Solana test a reimplementation instead of an adapter plug-in.
- Hardcoding `blockchain.chain === 'STELLAR'` in `VerifyAsset.tsx` will hide valid future Solana/Algorand proofs even if the backend contract is correct.
