# Phase 6: On-chain Asset Identity + Provenance — Specification

**Status:** Approved for planning
**Created:** 2026-05-17
**Depends on:** Phase 5 — Unified Tenant Identity + Data Backfill
**Primary chain:** Stellar/Soroban

## Goal

Every real-world or digital entity managed by Quantum Cert must be represented as an `Asset` in the application and as an on-chain identity/provenance record. This includes profiles, dependents, pets, objects, documents, QTAGs, devices, and future domain-specific entities.

Physical QTAGs are special: the chip/device must have its own Asset identity, but it can only become active when linked to exactly one protected Asset and after successful physical commissioning.

The application and the chain must expose one coherent visibility layer: the app holds private data and operational workflows; Stellar/Soroban holds public/verifiable identifiers, hashes, status, and event provenance.

## Current Problem

The current backend creates a local `Asset`, then creates approved `EventLog` records whose hashes are anchored by `AnchorQueueService`. That proves a payload/event existed, but it does not make every entity visible as an on-chain asset identity. A profile, dependent, pet, or object can therefore exist in the product without a first-class on-chain Asset/registry record.

## Target Model

Every creation flow must pass through the Asset Engine:

```text
TenantUser/Profile -> Asset(type=PROFILE)
Dependent          -> Asset(type=DEPENDENT)
Pet                -> Asset(type=PET)
Object             -> Asset(type=OBJECT)
Document           -> Asset(type=DOCUMENT)
QTAG/Device        -> Asset(type=QTAG/DEVICE)
```

Each Asset receives:

- local `Asset.id`;
- tenant/user ownership references from Phase 5;
- public URL/public identifier;
- on-chain identity record;
- on-chain event trail;
- explorer/contract proof links.

For QTAGs, the model must additionally preserve:

- `qtagAssetId` for the physical tag/device identity;
- `protectedAssetId` for the Asset the tag protects;
- fulfillment/order reference from Phase 4;
- `EncodingSession`/`Device` references after physical commissioning starts;
- status separation between purchased/reserved/in fulfillment and active.

## On-chain Design Direction

Use Stellar/Soroban as the primary registry path.

The planning phase must choose the exact issuance topology, but it must satisfy:

1. no PII on-chain;
2. one stable Stellar asset identity per local Asset;
3. event trail by Asset;
4. public verification by asset identifier;
5. idempotent backfill for existing assets.

Recommended direction:

- issue or materialize a Stellar asset identity for every local `Asset`, storing the canonical `asset_code + issuer` key;
- use a tenant-scoped issuer model by default, unless planning proves per-asset issuers are required;
- use deterministic, non-PII asset codes derived from the local asset ID/hash and constrained to Stellar asset-code limits;
- use a Quantum Cert Soroban registry contract for `register_asset` and `record_event`;
- deploy/use Stellar Asset Contract identity when contract interoperability is needed;
- store hashes and identifiers on-chain, not raw personal/private payloads;
- keep the existing `EventLog` as local projection and retry queue source, but make the on-chain event the confirmation target.

Registry-only storage is not enough for the StellarExpert Asset Info surface. The asset registry gives Quantum Cert's provenance semantics; the Stellar asset key (`asset_code + issuer`) gives the network-level Asset identity that explorers/indexers can query.

## Required Records

Add backend persistence for on-chain identity, such as `OnChainAsset` or equivalent:

- `assetId`;
- `tenantId`;
- `chain`;
- `network`;
- `assetCode`;
- `issuer`;
- `stellarAssetKey`;
- `issuanceTxId` or equivalent materialization transaction;
- `supplyPolicy` / holder policy, even when the asset exists only for identity/provenance;
- `registryContractId`;
- `sacContractId` when applicable;
- `registrationTxId`;
- `latestEventTxId`;
- `latestEventHash`;
- `status`;
- `backfillStatus`;
- timestamps and error metadata.

Add or extend event persistence to track:

- canonical event type;
- payload hash;
- previous event hash;
- actor hash/user reference;
- txId;
- confirmation status;
- public/private visibility policy.

## Chain Event Requirements

At minimum, the on-chain trail must support:

- asset registered;
- profile/dependent linked;
- ownership granted/revoked/accepted/transferred;
- lifecycle state changed;
- document attached/verified;
- QTAG linked/commissioned/scanned/rejected;
- QTAG dispatched/activated after confirmed physical commissioning;
- incident reported/resolved;
- escrow locked/released/cancelled when later phases enable escrow.

## Backfill Requirements

The backfill must run after Phase 5 has stable users and ownership.

Order:

1. Find all assets without on-chain identity.
2. Reserve or derive a deterministic Stellar asset code for each asset.
3. Materialize the Stellar asset identity and persist `asset_code + issuer`.
4. Register each asset in the Soroban registry.
5. Create a minimal `ASSET_REGISTERED` event for each asset if absent.
6. Replay or summarize existing approved `EventLog` records into on-chain provenance, based on a planning decision about historical fidelity vs compact migration.
7. Store txIds and confirmation status.
8. Emit a report of successful registrations, pending retries, chain failures, conflicts and skipped assets.

## Public Verification

The public API must return one proof object for every verifiable asset:

```json
{
  "assetId": "local-asset-id",
  "entityType": "PROFILE | DEPENDENT | PET | OBJECT | DOCUMENT | QTAG",
  "status": "ACTIVE",
  "blockchain": {
    "chain": "STELLAR",
    "network": "testnet",
    "registryContractId": "C...",
    "stellarAssetKey": "CODE-G...",
    "registrationTxId": "...",
    "latestEventTxId": "...",
    "explorerUrl": "https://stellar.expert/..."
  }
}
```

Flat legacy fields from document verification should remain compatible until clients migrate.

## Acceptance Criteria

1. Creating a profile, dependent, pet, object, document or QTAG creates a local Asset and queues on-chain registration.
2. A confirmed asset has an on-chain identity and at least one `ASSET_REGISTERED` event.
3. An approved app event is visible in the local timeline and in the on-chain proof surface.
4. Public verification can prove the asset without exposing PII.
5. Existing assets are backfilled idempotently.
6. The dashboard renders one unified proof/timeline for local and on-chain data.
7. Failures go to retry/blocked states; an asset is not shown as fully certified while required on-chain registration is pending or failed.
8. A QTAG/Device Asset is linked to exactly one protected Asset before activation, and on-chain provenance records `QTAG_LINKED`, `QTAG_COMMISSIONED`, dispatch/activation and scan/rejection events.

## Reference Notes

- Stellar assets are identified by asset code and issuer, and the issuer remains linked to the asset identity.
- Stellar requires trustline/issuance mechanics for non-native assets; planning must define how Quantum Cert materializes identity assets without exposing private data or requiring end-user wallet friction.
- StellarExpert Asset Info API can search/list assets by code, issuer, home domain and `stellar.toml` metadata, and exposes holders/supply/rating surfaces; Quantum Cert should use it as an external verification/indexer surface, not as the authoritative operational database.

## Out of Scope

- Final escrow logic.
- Full Solana parity.
- Smart contract security audit for mainnet.
- Business pricing for on-chain registration/certification.
