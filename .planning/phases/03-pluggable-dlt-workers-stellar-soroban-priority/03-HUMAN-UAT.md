---
status: passed
phase: 03-pluggable-dlt-workers-stellar-soroban-priority
source: [03-03-PLAN.md]
started: 2026-05-14T03:04:00Z
updated: 2026-05-14T19:07:24Z
---

# Phase 03 Human UAT

## Current Test

Backend Stellar testnet evidence, external transaction availability, and
dashboard visual proof collected.

## Scope

This UAT closes the hackathon Stellar/Soroban slice only. `DLT-02` Solana and
`DLT-05` persisted `lastScannedBlock` remain intentionally deferred backlog
items and do not block this Stellar UAT.

## Checklist

- [x] `npm run provision:stellar` executed successfully.
- [x] `STELLAR_ANCHOR_CONTRACT_ID` defined in the runtime environment.
- [x] Demo tenant configured with `targetChain = STELLAR`.
- [x] Approved event created for the demo asset/document.
- [x] `AnchorQueueService.processQueue()` processed the event.
- [x] `EventLog.dltTxId` populated with the Stellar transaction id.
- [x] `ChainTransaction.tenantId` equals the demo tenant id.
- [x] Stellar Expert URL opened and verified.
- [x] `get_anchor_hash` confirms the anchored hash in the Soroban contract.
- [x] Document verify with `X402_ENABLED=false` returns 200 and includes `blockchain.chain = STELLAR`.
- [x] Dashboard shows `Verificação Blockchain` with `chain = STELLAR`.
- [x] [nice-to-have] Future experimental payment mode does not block Stellar/Soroban acceptance.

## Evidence Fields

- Stellar txId: `75f2d84ec135f06a903b91a82484bb6b82267ed002605a5827d54143fc8dd5cc`
- Stellar Expert URL: `https://stellar.expert/explorer/testnet/tx/75f2d84ec135f06a903b91a82484bb6b82267ed002605a5827d54143fc8dd5cc`
- Stellar Expert availability: HTTP 200 on 2026-05-14.
- Horizon testnet confirmation: hash `75f2d84ec135f06a903b91a82484bb6b82267ed002605a5827d54143fc8dd5cc`, `successful=true`, ledger `2553745`, created at `2026-05-14T16:52:18Z`, operation count `1`.
- Contract ID: `CA7PR26A2WDPHWOXIVLYYS2KEN77DOQ3FJSS5GR5MGEMMYT35RBXEAVO`
- EventLog id: `cmp5pz52100013u51hjol1hy9`
- ChainTransaction id: `cmp5q7xsu0004oz32u4agb6x5`
- Demo tenant id: `cmp4ngmac0000aixz51o2bosq`
- Demo tenant slug: `uat-qtag-phase-2`
- Demo asset id: `8ff3e441-8f48-4b98-af60-8acd9a136c6f`
- Document hash: `90c476cdd1bf5c9c5239e13f727eb59339c458a6bfc156603f0d7bdc504f40363c3f9802ef0410867a2c2691938cea483418bb3136df8f5e217f51705833f1ba`
- Public verify: `GET /api/v1/public/verify/document/{documentHash}` returned HTTP 200 with `verified=true`, `chain=STELLAR`, `confirmationStatus=CONFIRMED`, and `blockchain.chain=STELLAR`.
- Dashboard URL: `http://localhost:3001/public/verify/8ff3e441-8f48-4b98-af60-8acd9a136c6f`
- Screenshot/dashboard note: validated by human on 2026-05-14. The public page showed `Registro Ativo & Verificado`, `Verificação Blockchain`, `STELLAR`, txId `75f2d84ec135f06a903b91a82484bb6b82267ed002605a5827d54143fc8dd5cc`, and the `Ver no explorer` action.
- `get_anchor_hash` output: `{"authority":"GBJ2OEBF65VQLVQRBDWBMOB7DWJNRB4FPCXTVDRU4WX2R5SDJGNLVFGB","created_at":1778777538,"payload_hash":"41d28627d2fe95f33ed02a84e97b064ac0e0c39b3902b68479a8bd9a4d85e18291f8d5d7d864b485ba8add6b2cd71043e72ec45a5698f7dafb338836d1b423d5","status":1,"unlock_timestamp":0}`

## Expected Result

The public proof can be inspected end to end: qc-backend records the tenant-safe
Stellar anchor, `/api/v1/public/verify/document/{hash}` returns a generic
`blockchain` object, Stellar Expert opens the transaction, and qc-dashboard
renders the cross-chain blockchain proof card.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

No blocking UAT gaps remain for the Stellar/Soroban hackathon slice.
