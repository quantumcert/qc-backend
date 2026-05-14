# Phase 3: Pluggable DLT Workers - Stellar/Soroban Priority - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 03-pluggable-dlt-workers-stellar-soroban-priority
**Areas discussed:** SPEC as source of truth, scope reconciliation, x402/micropayment classification, dashboard inclusion

---

## SPEC as Source of Truth

| Option                   | Description                                                                                        | Selected |
| ------------------------ | -------------------------------------------------------------------------------------------------- | -------- |
| Use `03-SPEC.md` only    | Treat locked SPEC requirements as the phase context and proceed to planning.                       |          |
| Run discuss-phase only   | Pause planning and gather context from scratch.                                                    |          |
| Use SPEC plus discussion | Use `03-SPEC.md` as locked context and add implementation decisions where the repo/spec have gaps. | yes      |

**User's choice:** `1 e 2`.
**Notes:** Interpreted as "use `03-SPEC.md` as context and also run a discussion pass before planning."

---

## Scope Reconciliation

| Option                                | Description                                                                                            | Selected |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| Follow ROADMAP requirements literally | Include Stellar, Solana, and persisted `lastScannedBlock` in Phase 3.                                  |          |
| Follow SPEC hackathon slice           | Implement Stellar/Soroban proof, keep payment/x402 optional, and defer Solana plus `lastScannedBlock`. | yes      |
| Split phase before planning           | Create sub-phases before writing plans.                                                                |          |

**User's choice:** Implied by selecting `03-SPEC.md` as source of truth.
**Notes:** `03-SPEC.md` explicitly says Solana and persisted `lastScannedBlock` are out of scope for the hackathon slice. CONTEXT.md records this as D-01 through D-03 so downstream plans do not silently expand scope.

## Stellar-first / Solana-ready Architecture

| Option                         | Description                                                                                                        | Selected |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Stellar-only shortcut          | Hardcode Stellar in queue/proof paths to maximize hackathon speed.                                                 |          |
| Stellar-first, Solana-ready    | Make Stellar work now while preserving `targetChain`, `DLTAdapterFactory`, `IDLTAdapter`, and generic proof shape. | yes      |
| Implement Solana in this phase | Add Solana adapter immediately to prove both chains.                                                               |          |

**User's choice:** Stellar é o foco principal agora, mas a plataforma já está preparada para multi-chain e não deve exigir muita reimplementação quando Solana for testada.
**Notes:** Solana implementation remains deferred, but Phase 3 code must keep the chain boundary flexible and atomic: one resolved `targetChain`, one adapter, one persisted `ChainTransaction.chain`, and one generic public `blockchain` contract.

---

## x402 / Micropayment Classification

| Option                                    | Description                                                                                   | Selected |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| Treat x402 as must-have                   | Require HTTP 402/paid verification before closing Phase 3.                                    |          |
| Treat x402 as nice-to-have env-gated hook | Keep verification free by default and prepare payment gating only behind an explicit env var. | yes      |
| Defer all payment work                    | Remove payment hook entirely from Phase 3.                                                    |          |

**User's choice:** x402 is not a must-have; it is a nice-to-have. The implementation should be implicit/opt-in by env var while product decides whether micropayments will be implemented.
**Notes:** Future commercial direction should evaluate an Anchor integration with BRZ/Real Brasileiro pair, with Transfero as an example candidate. Do not lock Phase 3 to USDC or a specific x402 package.

---

## Dashboard Inclusion

| Option                          | Description                                                                          | Selected |
| ------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Backend only                    | Expose the contract and leave dashboard to a separate repo phase.                    |          |
| Include sibling dashboard badge | Plan the `qc-dashboard` proof badge because the SPEC acceptance criteria require it. | yes      |
| Mock dashboard only             | Add non-integrated demo UI without backend data.                                     |          |

**User's choice:** Implied by locked requirement 5 in `03-SPEC.md`.
**Notes:** CONTEXT.md includes the sibling repo files as canonical refs and keeps local/demo fallback behavior as a constraint.

### Dashboard Proof Scope Correction

**User's correction:** Dashboard proof must work for all chains, not only Stellar.
**Decision:** The current UAT still proves Stellar, but `VerifyAsset.tsx` must render a generic "Verificação Blockchain" card for any `blockchain.chain` + `blockchain.dltTxId`. `blockchain.explorerUrl` controls only whether an external explorer link is shown. Do not filter rendering with `blockchain.chain === 'STELLAR'`.

---

## Agent's Discretion

- Exact plan split and test split.
- Whether the optional payment hook is a no-op middleware, provider abstraction, or future x402 wrapper.
- Exact env var names, as long as default behavior is disabled/free and future Anchor/BRZ direction is documented.
- Exact Solana-ready implementation details, as long as core code avoids Stellar-only coupling and keeps chain-specific logic in adapters/helpers.
- Exact dashboard visual treatment, as long as the proof card is chain-generic and not Stellar-gated.

## Deferred Ideas

- Solana adapter, implemented later through the existing multi-chain seams.
- Persisted `lastScannedBlock`/observer checkpoint state.
- Stellar mainnet deploy and contract audit.
- Real micropayment provider implementation through Anchor/BRZ, potentially Transfero.
- x402 monetization for additional public endpoints.
