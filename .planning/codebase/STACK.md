# Technology Stack

_Generated: 2026-05-08 | Focus: tech_

## Summary

qc-backend is a Node.js 20 + TypeScript 5.3 API implementing a Diamond Pattern (EIP-2535 adaptation) for multi-tenant asset certification on multiple blockchains. It uses Express as the HTTP layer, Prisma as the ORM against PostgreSQL, and Vitest for testing. Build output is a compiled CommonJS bundle at `dist/server.js`.

## Languages

**Primary:**
- TypeScript 5.3 — all application source under `src/`
- Target: ES2022, module: CommonJS (`tsconfig.json`)

**Secondary:**
- SQL — via Prisma migrations in `prisma/`

## Runtime

**Environment:**
- Node.js 20 (pinned in `Dockerfile` — `node:20-alpine`)
- No `.nvmrc` or `.node-version` file present

**Package Manager:**
- npm (lockfile: `package-lock.json` — present)

## Frameworks

**Core:**
- Express `^4.18.2` — HTTP server, routing, middleware chain
- Prisma `^5.7.0` — ORM + schema management for PostgreSQL
- Zod `^3.22.4` — runtime schema validation (env config in `src/config/env.ts`, request payloads in controllers)

**Testing:**
- Vitest `^1.0.4` — unit + e2e test runner
  - Config: `vitest.config.ts`
  - Pool: `forks`, `singleFork: true`
  - Inline dependency: `uuid`
- Supertest `^7.2.2` — HTTP integration testing helper
- Autocannon `^8.0.0` — load/perf testing tool (devDependency)

**Build/Dev:**
- tsx `^4.7.0` — TypeScript execution + hot-reload (`npm run dev`)
- tsc `^5.3.3` — production compile (`npm run build → dist/`)
- Prisma CLI `^5.7.0` — schema push, migrations, client generation

## Key Dependencies

**Critical:**
- `@prisma/client ^5.7.0` — database client, generated at `postinstall`
- `express ^4.18.2` — HTTP layer
- `algosdk ^3.5.2` — Algorand node SDK (primary DLT adapter)
- `falcon-crypto ^1.0.6` — Falcon-512 post-quantum signing; used in `src/utils/PostQuantumCrypto.ts`, `src/services/KMSService.ts`, `src/services/WalletService.ts`
- `zod ^3.22.4` — validation; critical for env startup guard in `src/config/env.ts`

**Blockchain SDKs:**
- `algosdk ^3.5.2` — Algorand; adapter: `src/services/multi-chain/AlgorandAdapter.ts`
- `ethers ^6.13.0` — Ethereum/EVM; adapters: `src/services/multi-chain/EthAdapter.ts`, `PolygonAdapter.ts`
- `@solana/web3.js ^1.95.0` — Solana; adapter: `src/services/multi-chain/SolanaAdapter.ts`
- `@stellar/stellar-sdk ^12.0.0` — Stellar/Soroban; adapter: `src/services/multi-chain/SorobanAdapter.ts`
  - Mocked in tests via `__mocks__/@stellar/stellar-sdk.ts` (alias in `vitest.config.ts`)

**Infrastructure:**
- `bcryptjs ^3.0.3` — API key hashing (raw key shown once, stored as bcrypt hash)
- `helmet ^7.1.0` — HTTP security headers
- `cors ^2.8.5` — CORS (allowed origin: `FRONTEND_URL` env var)
- `express-rate-limit ^8.2.1` — global IP rate limiter (in-memory Map, `src/server.ts`)
- `node-cron ^4.2.1` — cron scheduling for background workers (`src/services/SchedulerService.ts`)
- `uuid ^13.0.0` — idempotency key generation and asset IDs
- `dotenv ^16.3.1` — `.env` loading at startup
- `mercadopago ^2.12.0` — MercadoPago payment SDK (`src/services/core-facets/BillingFacet.ts`)
- `node-aes-cmac ^0.1.1` — AES-CMAC for NFC/NTAG SDM verification (`src/services/QTagCryptoService.ts`, `src/services/core-facets/NfcValidationFacet.ts`)
- `tweetnacl` — NaCl crypto; used in `src/services/KMSService.ts` for Solana key derivation

**API Documentation:**
- `swagger-jsdoc ^6.2.8` — OpenAPI spec generation (`src/docs/openapi.ts`)
- `@scalar/api-reference ^1.52.1` — interactive API reference UI
- `@scalar/express-api-reference ^0.9.7` — Express middleware for Scalar UI (`src/routes/v1/docsRoutes.ts`)

## Configuration

**Environment:**
- Loaded via `dotenv` at startup
- Schema-validated at boot with Zod in `src/config/env.ts`
- App crashes at startup if required vars are missing
- Required: `DATABASE_URL`, `ALGOD_SERVER`, `ALGORAND_MASTER_MNEMONIC`
- Template: `.env.example` (committed)

**Build:**
- `tsconfig.json` — strict mode, ES2022 target, CommonJS modules, `dist/` output, source maps + declarations enabled
- `vitest.config.ts` — test runner config with Stellar SDK mock alias

## Platform Requirements

**Development:**
- Node.js 20+
- PostgreSQL (connection via `DATABASE_URL`)
- Copy `.env.example` → `.env` before running

**Production:**
- Docker multi-stage build (`Dockerfile`): builder stage compiles + generates Prisma client; runner stage installs prod-only deps
- Base image: `node:20-alpine` with OpenSSL (required by Prisma)
- Runs as non-root `node` user
- Exposed port: `3000`
- No docker-compose file present — deployment via Dokploy (referenced in commit history)

---

*Stack analysis: 2026-05-08*
