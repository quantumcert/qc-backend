# External Integrations

_Generated: 2026-05-08 | Focus: tech_

## Summary

qc-backend integrates with five blockchain networks (Algorand, Ethereum, Polygon, Solana, Stellar/Soroban), MercadoPago for payments, and PostgreSQL as the sole data store. All private key access is abstracted through `KMSService` (`src/services/KMSService.ts`), which reads env vars in dev/test and is designed for migration to AWS KMS, HashiCorp Vault, or Azure KeyVault in production. No Redis, S3, or external logging/monitoring services are currently integrated.

## APIs & External Services

**Blockchain — Algorand:**
- Purpose: Primary anchoring chain; zero-value transactions with encoded event hash + Falcon-512 sig in note field
- SDK: `algosdk ^3.5.2`
- Adapter: `src/services/multi-chain/AlgorandAdapter.ts`
- Facet: `src/services/core-facets/AlgorandAnchorFacet.ts`
- Auth env vars:
  - `ALGOD_SERVER` — Algorand node URL (e.g., `https://testnet-api.algonode.cloud`)
  - `ALGOD_TOKEN` — node API token (can be empty for public nodes)
  - `ALGOD_PORT` — node port (can be empty)
  - `ALGORAND_MASTER_MNEMONIC` — Omnibus wallet mnemonic (KMSService-managed)
  - `ALGORAND_USDC_ASA_ID` — USDC ASA ID for deposit observer (mainnet: `31566704`)

**Blockchain — Ethereum:**
- Purpose: EVM anchoring + stablecoin deposit observation (USDC/USDT)
- SDK: `ethers ^6.13.0`
- Adapter: `src/services/multi-chain/EthAdapter.ts`
- Auth env vars:
  - `ETHEREUM_RPC_URL` — RPC endpoint (e.g., Infura)
  - `ETHEREUM_PRIVATE_KEY` — signing wallet private key (KMSService-managed)
  - `ETHEREUM_TRANSFER_FACET_ADDRESS` — deployed contract address
  - `ETHEREUM_USDC_CONTRACT` — USDC contract address for observer
  - `ETHEREUM_USDT_CONTRACT` — USDT contract address for observer
  - `DEPOSIT_CONFIRMATIONS_ETHEREUM` — block confirmations threshold (default: 12)

**Blockchain — Polygon:**
- Purpose: EVM anchoring on Polygon + stablecoin deposit observation
- SDK: `ethers ^6.13.0` (shared with Ethereum)
- Adapter: `src/services/multi-chain/PolygonAdapter.ts`
- Auth env vars:
  - `POLYGON_RPC_URL` — RPC endpoint
  - `POLYGON_PRIVATE_KEY` — signing wallet private key (KMSService-managed)
  - `POLYGON_TRANSFER_FACET_ADDRESS` — deployed contract address
  - `POLYGON_USDC_CONTRACT` — USDC contract address for observer
  - `POLYGON_USDT_CONTRACT` — USDT contract address for observer
  - `DEPOSIT_CONFIRMATIONS_POLYGON` — block confirmations threshold (default: 12)

**Blockchain — Solana:**
- Purpose: Solana anchoring (pluggable adapter)
- SDK: `@solana/web3.js ^1.95.0`
- Adapter: `src/services/multi-chain/SolanaAdapter.ts`
- Auth env vars:
  - `SOLANA_RPC_URL` — RPC endpoint (mainnet/devnet/local)
  - `SOLANA_AUTHORITY_PRIVATE_KEY` — base64-encoded private key (KMSService-managed)
  - `SOLANA_ANCHOR_PROGRAM_ID` — deployed Anchor program ID

**Blockchain — Stellar / Soroban:**
- Purpose: Stellar anchoring + Soroban smart contract interaction
- SDK: `@stellar/stellar-sdk ^12.0.0`
- Adapter: `src/services/multi-chain/SorobanAdapter.ts`
- Mock: `__mocks__/@stellar/stellar-sdk.ts` (aliased in `vitest.config.ts` to prevent real network calls in tests)
- Auth env vars:
  - `STELLAR_HORIZON_URL` — Horizon REST API URL
  - `STELLAR_SOROBAN_RPC_URL` — Soroban RPC URL
  - `STELLAR_AUTHORITY_SECRET_KEY` — signing account secret key (KMSService-managed)
  - `STELLAR_ANCHOR_CONTRACT_ID` — deployed Soroban contract ID
  - `STELLAR_NETWORK_PASSPHRASE` — network identifier string

**Payments — MercadoPago:**
- Purpose: Payment preference creation and webhook confirmation for asset transfers
- SDK: `mercadopago ^2.12.0`
- Implementation: `src/services/core-facets/BillingFacet.ts`
- Webhook route: `POST /api/v1/webhooks/mercadopago` (no `apiKeyAuth`, own signature validation)
- Auth env vars:
  - `MP_WEBHOOK_SECRET` — HMAC secret for webhook signature validation

**Cryptography — Post-Quantum (Falcon-512):**
- Purpose: PQC signing embedded in DLT note fields; M2M agent payload validation
- Library: `falcon-crypto ^1.0.6`
- Implementation: `src/utils/PostQuantumCrypto.ts`
- Used by: `src/services/KMSService.ts`, `src/services/WalletService.ts`, `src/services/QuantumSignerService.ts`, `src/middleware/requireAgentSignature.ts`

**Cryptography — NFC/NTAG SDM (AES-CMAC):**
- Purpose: NTAG 424 DNA Secure Dynamic Messaging verification for physical NFC tags (QTAG sub-system)
- Library: `node-aes-cmac ^0.1.1`
- Implementation: `src/services/QTagCryptoService.ts`, `src/services/core-facets/NfcValidationFacet.ts`, `src/services/SDMVerifierService.ts`

## Data Storage

**Databases:**
- PostgreSQL — sole persistent store for all application data
  - Connection env var: `DATABASE_URL`
  - Client/ORM: Prisma `^5.7.0` (`src/config/prisma.ts`)
  - Schema: `prisma/schema.prisma`
  - Rate limiting counters, audit logs, asset records, event logs, tenants, API keys — all in PostgreSQL

**File Storage:**
- Local filesystem only — no S3 or object storage integration detected

**Caching:**
- None — no Redis or in-memory cache layer
- Global IP rate limiter uses an in-memory `Map` (process-local, lost on restart) in `src/server.ts`
- Tenant-level rate limiting uses `RateLimitCounter` Postgres table via `src/services/core-facets/RateLimiterFacet.ts`
- KMSService has a 5-minute in-memory cache for key lookups (disabled in `TEST` mode)

## Authentication & Identity

**Auth Provider:**
- Custom — no OAuth, Cognito, or Auth0
- API keys with `qc_` prefix, passed via `X-API-Key` header or `Authorization: Bearer qc_...`
- Keys stored as bcrypt hashes (`bcryptjs ^3.0.3`)
- Roles: `ADMIN > OPERATOR > READER` (enforced by `src/middleware/rbacGuard.ts`)
- Tenant context injected by `requireApiKey` middleware — never from request body

**Key Management:**
- `src/services/KMSService.ts` — abstraction layer over all DLT private keys
  - Dev/test: reads from `.env`
  - Production path: designed for AWS KMS / HashiCorp Vault / Azure KeyVault (migration requires only KMSService changes)

## Monitoring & Observability

**Error Tracking:**
- Not detected — no Sentry, Datadog, or similar integration

**Logs:**
- `console.log` / `console.error` — no structured logging library (Winston, Pino, etc.)

**Security Watchdog:**
- `src/services/SecurityWatchdogService.ts` — internal service, scheduled via `SchedulerService`; purpose: anomaly detection (implementation details require deeper read)

## CI/CD & Deployment

**Hosting:**
- Dokploy (referenced in commit `aaa482e` — "fix: corrige erros de compilação TypeScript que quebraram o build no Dokploy")
- Docker multi-stage build via `Dockerfile`

**CI Pipeline:**
- None detected — no `.github/workflows/` directory found

## Background Workers & Scheduling

All workers registered in `src/services/SchedulerService.ts` using `node-cron ^4.2.1`:

| Worker | Env var | Default | Purpose |
|---|---|---|---|
| AnchorQueue | `ANCHOR_QUEUE_INTERVAL_SECONDS` | 30s | Process `EventLog` records with `dltTxId: null` |
| RetryWorker | `RETRY_WORKER_INTERVAL_SECONDS` | 15s | Retry failed DLT anchors (max: `RETRY_MAX_ATTEMPTS=5`) |
| BlockchainObserver | `BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS` | 30s | Poll chains for custodial stablecoin deposits |
| SecurityWatchdog | (hardcoded) | 60s | Internal security anomaly detection |
| EscrowRelease | `ESCROW_RELEASE_INTERVAL_SECONDS` | 60s | Release time-locked escrow assets |

## Webhooks & Callbacks

**Incoming:**
- `POST /api/v1/webhooks/mercadopago` — MercadoPago payment confirmation; signature validated via `MP_WEBHOOK_SECRET`; no `apiKeyAuth` middleware

**Outgoing:**
- Not detected — no HTTP client for outbound webhook delivery

## Environment Configuration Summary

**Required at startup (app crashes without these):**
- `DATABASE_URL`
- `ALGOD_SERVER`
- `ALGORAND_MASTER_MNEMONIC`

**Required for full feature set:**
- `ETHEREUM_RPC_URL`, `ETHEREUM_PRIVATE_KEY`, `ETHEREUM_TRANSFER_FACET_ADDRESS`
- `POLYGON_RPC_URL`, `POLYGON_PRIVATE_KEY`, `POLYGON_TRANSFER_FACET_ADDRESS`
- `SOLANA_RPC_URL`, `SOLANA_AUTHORITY_PRIVATE_KEY`, `SOLANA_ANCHOR_PROGRAM_ID`
- `STELLAR_HORIZON_URL`, `STELLAR_SOROBAN_RPC_URL`, `STELLAR_AUTHORITY_SECRET_KEY`, `STELLAR_ANCHOR_CONTRACT_ID`, `STELLAR_NETWORK_PASSPHRASE`
- `MP_WEBHOOK_SECRET`
- `QUANTUM_CERT_SECRET`

**Optional / tuning:**
- `ALGOD_TOKEN`, `ALGOD_PORT`
- `ANCHOR_QUEUE_INTERVAL_SECONDS`, `RETRY_WORKER_INTERVAL_SECONDS`, `RETRY_MAX_ATTEMPTS`
- `ESCROW_RELEASE_INTERVAL_SECONDS`, `BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS`
- `DEPOSIT_CONFIRMATIONS_POLYGON`, `DEPOSIT_CONFIRMATIONS_ETHEREUM`, `DEPOSIT_CONFIRMATIONS_ALGORAND`
- `ALGORAND_USDC_ASA_ID`, `POLYGON_USDC_CONTRACT`, `POLYGON_USDT_CONTRACT`, `ETHEREUM_USDC_CONTRACT`, `ETHEREUM_USDT_CONTRACT`
- `PORT` (default: 3000), `NODE_ENV`, `FRONTEND_URL`

**Secrets location:**
- Dev: `.env` file (gitignored)
- Production target: AWS KMS / HashiCorp Vault / Azure KeyVault (via KMSService abstraction)

## Gaps / Unknowns

- No CI pipeline detected — unclear how tests are run on PRs
- No structured logging library — log aggregation strategy for production is unknown
- No error tracking service (Sentry, etc.) — production error visibility is unclear
- `tweetnacl` is used in `KMSService.ts` but is not listed in `package.json` — likely a transitive dependency of `@solana/web3.js`; should be made explicit if used directly
- `SecurityWatchdogService.ts` internal behavior not fully explored — extent of anomaly detection rules unknown

---

*Integration audit: 2026-05-08*
