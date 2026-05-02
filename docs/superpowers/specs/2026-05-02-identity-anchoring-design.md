# Identity Anchoring on Profile Completion

**Date:** 2026-05-02  
**Status:** Approved  
**Repos:** `qc-backend` (IdentityFacet) + `qc-dashboard` (trigger + badge)

---

## Goal

When a user completes their profile for the first time (name + CPF + date of birth + email all filled), their identity is registered as an Asset in qc-backend and anchored on the Algorand blockchain. The user sees a "Identidade Certificada" badge with a link to the transaction once anchoring completes.

---

## Trigger

- **Who:** The user, by saving their profile via `auth.updateProfile`
- **When:** First save where all four fields are present: `name`, `cpf`, `dateOfBirth`, `email`
- **How many times:** Once. If `users.identityAssetId` is already set, registration is skipped
- **On failure:** Profile save succeeds regardless. Identity anchoring goes to queue and retries automatically via `AnchorQueueService`

---

## Data Flow

```
User saves profile (name + CPF + dob + email filled)
  │
  ├─ qc-dashboard: upsertUser() → persists to local DB
  │
  ├─ qc-dashboard: QCBackendClient.diamond("identity.register", payload)
  │     │
  │     └─ qc-backend: IdentityFacet.register()
  │           ├─ idempotency check (ownerRef already exists → return existing)
  │           ├─ Asset.create { type: "identity", ownerRef, metadata: { name, cpf, dob, email } }
  │           ├─ EventLog.create { eventType: "IDENTITY_REGISTERED", dltTxId: null }
  │           └─ returns { assetId, status: "pending" }
  │
  ├─ qc-dashboard: saves identityAssetId + identityStatus: "pending"
  │
  └─ Badge: "Certificação Pendente..."

Background (AnchorQueueService — existing):
  EventLog(dltTxId: null) → AlgorandAnchorFacet → dltTxId filled

User opens profile page:
  qc-dashboard: QCBackendClient.diamond("identity.status", { assetId })
    └─ returns { status: "certified", txId: "ALGO..." }
  Badge: "Identidade Certificada ✓" + Algorand Explorer link
```

---

## qc-backend Changes

### New file: `src/services/core-facets/IdentityFacet.ts`

**`register(secureContext, payload)`**
- `payload: { ownerRef: string, name: string, cpf: string, dateOfBirth: string, email: string }`
- Idempotent: checks for existing Asset with `ownerRef` and `metadata.type = "identity"` — returns existing without creating duplicate
- Creates Asset with `externalId = ownerRef`, `metadata = { name, cpf, dateOfBirth, email, type: "identity" }`
- Creates EventLog `{ eventType: "IDENTITY_REGISTERED", dltTxId: null }` → picked up by AnchorQueueService
- Returns `{ assetId: string, status: "pending" }`
- RBAC: requires `OPERATOR` or `ADMIN`

**`getStatus(secureContext, payload)`**
- `payload: { assetId: string }`
- Fetches latest EventLog with `eventType = "IDENTITY_REGISTERED"` for the asset
- Returns `{ status: "pending" }` if `dltTxId` is null
- Returns `{ status: "certified", txId: string, anchoredAt: Date }` if filled
- Returns error `NOT_FOUND` if asset does not exist
- RBAC: requires `READER`

### FacetRegistry additions (`src/diamond/FacetRegistry.ts`)

```ts
'identity.register': IdentityFacet.register,
'identity.status':   IdentityFacet.getStatus,
```

---

## qc-dashboard Changes

### Schema migration — `drizzle/schema.ts`

```ts
identityAssetId: varchar("identityAssetId", { length: 255 }),
identityStatus:  varchar("identityStatus",  { length: 20 }).default("none"),
// values: 'none' | 'pending' | 'certified'
```

Migration generated via `npm run db:generate` + `npm run db:migrate`.

### Server — `server/routers.ts` (`auth.updateProfile`)

After `db.updateUser(...)`, add identity registration logic:

```
if identityStatus === 'none' AND name + cpf + dateOfBirth + email all present:
  try:
    result = await qcClient.diamond("identity.register", { ownerRef, name, cpf, dateOfBirth, email })
    await db.upsertUser({ openId, identityAssetId: result.assetId, identityStatus: "pending" })
  catch:
    // silent — profile save already succeeded, queue will retry

if identityStatus === 'pending' AND identityAssetId present:
  try:
    result = await qcClient.diamond("identity.status", { assetId: identityAssetId })
    if result.status === 'certified':
      await db.upsertUser({ openId, identityStatus: "certified", metadata: { ...existing, identityTxId: result.txId } })
  catch:
    // silent — will retry on next profile open
```

### Frontend — `client/src/pages/UserProfile.tsx`

**On mount (`useEffect`):** if `user.identityStatus === 'pending'`, call `trpc.auth.checkIdentityStatus` mutation to trigger the status poll server-side.

**New tRPC procedure:** `auth.checkIdentityStatus` — calls `identity.status` on qc-backend and updates the user record.

**Badge component:**

| `identityStatus` | UI |
|---|---|
| `none` | hint text: "Preencha nome, CPF e data de nascimento para certificar sua identidade" |
| `pending` | 🟡 "Certificação pendente..." (spinner) |
| `certified` | ✅ "Identidade Certificada" + link `https://algoexplorer.io/tx/{txId}` |

---

## Testing

### qc-backend — `IdentityFacet` (unit, Prisma mocked)

```
identity.register
  ✓ creates Asset + EventLog with dltTxId: null
  ✓ idempotent — second call with same ownerRef returns existing asset without duplicating
  ✓ RBAC — READER role throws INSUFFICIENT_PERMISSIONS

identity.getStatus
  ✓ returns "pending" when dltTxId is null
  ✓ returns "certified" + txId when dltTxId is filled
  ✓ unknown assetId → throws NOT_FOUND
```

### qc-dashboard — `auth.updateProfile` (unit, qcClient mocked)

```
  ✓ incomplete fields → does not call identity.register
  ✓ all fields filled + identityStatus "none" → calls identity.register, saves assetId + "pending"
  ✓ identityStatus "pending" → calls identity.status, updates to "certified" when txId available
  ✓ identity.register throws → profile saved, identityStatus stays "none"
  ✓ identityStatus "certified" → calls nothing (already anchored)
```

### qc-dashboard — badge (component test)

```
  ✓ status "none"      → no badge, shows hint text
  ✓ status "pending"   → yellow badge with spinner
  ✓ status "certified" → green badge + Algorand Explorer link
```

---

## Out of Scope

- Re-anchoring when profile data changes after certification (future: `identity.update` selector)
- Multi-chain routing — anchors to Algorand only (current `AnchorQueueService` behavior)
- Admin UI to view all certified identities
- Email notification when certification completes
