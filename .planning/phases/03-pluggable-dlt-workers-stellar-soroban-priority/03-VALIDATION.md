# Phase 3: Pluggable DLT Workers - Stellar/Soroban Priority - Validation Strategy

**Date:** 2026-05-13
**Status:** Ready for execution

## Validation Goal

Prove the hackathon slice works end to end without faking the core proof: a Stellar-routed tenant anchors an approved event through Soroban, the backend persists tenant-scoped transaction metadata, public verification exposes the blockchain proof, and the dashboard can show a generic blockchain proof for any chain. The implementation must stay multi-chain-ready so a future Solana adapter can use the same queue/proof contract. Micropayment/x402 behavior is nice-to-have and must stay disabled by default.

## Automated Gates

### Backend Build and Type Safety

```bash
npm run build
```

Expected: exits 0.

### Stellar Adapter

```bash
npx vitest run tests/multi-chain/soroban-adapter.test.ts
```

Required assertions:

- adapter instantiates with testnet env vars.
- `anchorEvent()` returns a tx hash.
- `ChainTransaction.create` receives real tenant context or adapter no longer writes an incorrect `SYSTEM` tenant.
- `verifyAnchor()` still returns true for successful mock transaction.

### Anchor Queue Routing

```bash
npx vitest run tests/anchor-queue-stellar.test.ts
```

Required assertions:

- tenant `targetChain = STELLAR` calls `DLTAdapterFactory.getAdapter('STELLAR')`.
- event updates `dltTxId` with returned Stellar tx.
- tenant `targetChain = ALGORAND` still calls `getAdapter('ALGORAND')`.
- chain selection is atomic: one locked event uses one resolved target chain, one adapter, and one persisted `ChainTransaction.chain`.
- queue code remains driven by `tenant.targetChain` and does not introduce a Stellar-only routing branch that Solana would need to bypass.
- retry behavior still enqueues failures through `RetryWorker.enqueue`.

### Public Document Verification

```bash
npx vitest run tests/document-verification.test.ts
```

Required assertions:

- flat Phase 2 fields remain.
- `blockchain` is `null` when no anchor tx exists.
- `blockchain.dltTxId`, `blockchain.chain`, and `blockchain.anchoredAt` exist when a tx exists.
- `blockchain.explorerUrl` exists for Stellar and may be null for future chains until their explorer mapping is added.
- response uses generic fields (`blockchain.chain`, `dltTxId`, `explorerUrl`) and does not require Stellar-specific field names.
- no sensitive fields appear in the response.

### Optional Payment Hook Contract

```bash
npx vitest run tests/document-payment-gate.test.ts
```

Required assertions:

- with `X402_ENABLED=false` or env absent, `GET /api/v1/public/verify/document/{hash}` returns the normal document proof without payment.
- payment hook is route-scoped and is not mounted on `/api/v1/scan`.
- docs/env examples mark payment/x402 as optional and disabled by default.
- any enabled-provider behavior is tested only if a concrete provider is implemented; it is not required to close Phase 3.

### Provisioning Script

```bash
npx vitest run tests/provision-stellar.test.ts
```

Required assertions:

- script reuses existing `STELLAR_AUTHORITY_SECRET_KEY`.
- script can generate a new keypair without printing secrets to tracked files.
- script prints `STELLAR_HORIZON_URL`, `STELLAR_SOROBAN_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`, and `STELLAR_ANCHOR_CONTRACT_ID`.
- Friendbot/deploy calls are mocked in automated tests.

### Dashboard

From `../qc-dashboard`:

```bash
npx vitest run server/verify.asset.test.ts
npm run build
```

Required assertions:

- tRPC response can include `blockchain`.
- `VerifyAsset.tsx` renders proof for any chain when `blockchain.chain` and `blockchain.dltTxId` exist.
- `VerifyAsset.tsx` does not filter rendering with `blockchain.chain === 'STELLAR'`.
- existing demo/local fallback tests continue passing.

## Manual UAT Gates

1. Run provisioning against Stellar testnet and capture the contract id.
2. Start `qc-backend` with testnet `STELLAR_*` env vars and `X402_ENABLED=false`.
3. Create or update a demo tenant with `targetChain = STELLAR`.
4. Create an approved event/document hash for that tenant.
5. Run `AnchorQueueService.processQueue()` or wait for scheduler.
6. Verify database:
   - `EventLog.dltTxId` is populated.
   - latest `ChainTransaction.chain = STELLAR`.
   - latest `ChainTransaction.tenantId` equals the demo tenant id.
7. Open Stellar Expert transaction URL and confirm transaction exists.
8. Call public document verify without payment and confirm HTTP 200 with blockchain proof while `X402_ENABLED=false`.
9. Open dashboard `/public/verify/{id}` and confirm "Verificação Blockchain" appears with `chain = STELLAR` and the same explorer URL.
10. [Nice-to-have only] If an experimental provider is enabled, confirm payment behavior in a separate run without blocking Stellar acceptance.

## Blockers

- If Soroban CLI/toolchain cannot compile/deploy the contract, execution must stop and record the missing dependency instead of faking `STELLAR_ANCHOR_CONTRACT_ID`.
- If product decides to enable micropayments in this phase, update `03-RESEARCH.md` and plan tasks first with the selected provider. Preferred direction to evaluate: Anchor/BRZ, for example Transfero.
- If `qc-dashboard` is not available in the sibling path, backend execution can finish but the phase cannot pass the locked dashboard acceptance criterion.
