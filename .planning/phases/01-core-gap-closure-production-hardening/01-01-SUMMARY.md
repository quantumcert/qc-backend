---
phase: 01-core-gap-closure-production-hardening
plan: "01"
subsystem: pqc-security
tags: [falcon-512, post-quantum, circuit-breaker, kms, security, tdd]
dependency_graph:
  requires: []
  provides: [SEC-01, SEC-02, SEC-03]
  affects: [src/services/QuantumSignerService.ts, src/services/CircuitBreakerService.ts, src/services/KMSService.ts, src/server.ts]
tech_stack:
  added: []
  patterns: [TDD-RED-GREEN, fail-fast-production, fail-secure-dev]
key_files:
  created:
    - tests/quantum-signer-verify.test.ts
    - tests/circuit-breaker-security.test.ts
  modified:
    - src/services/QuantumSignerService.ts
    - src/services/CircuitBreakerService.ts
    - src/services/KMSService.ts
    - src/server.ts
    - .env.example
decisions:
  - "Usar publicKeyHex → base64 para compatibilidade com PostQuantumCrypto.verifySignatureFalcon512 que aceita base64"
  - "REQUIRED_ENV_VARS em produção gateado por NODE_ENV=production para não quebrar dev/test"
  - "verifyAdminSignature privado testado via TypeScript casting (service as any) — teste de contrato interno"
metrics:
  duration: "~25 minutos"
  completed: "2026-05-08"
  tasks_completed: 3
  files_changed: 7
---

# Phase 1 Plan 01: PQC Security Layer — Stub Elimination Summary

Eliminação de 3 vulnerabilidades catastróficas: stub `return true` no QuantumSignerService, CircuitBreaker aceitando qualquer string como assinatura válida, e chave Falcon efêmera em produção.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Testes falhando para QuantumSignerService.verifySignature | c87531c | tests/quantum-signer-verify.test.ts |
| 1 (GREEN) | Conectar verifySignature ao Falcon-512 real (SEC-02) | 03d2898 | src/services/QuantumSignerService.ts |
| 2 (RED) | Testes falhando para CircuitBreakerService.verifyAdminSignature | d45b571 | tests/circuit-breaker-security.test.ts |
| 2 (GREEN) | CircuitBreaker usa Falcon-512 real + env var (SEC-03) | ee32e2b | src/services/CircuitBreakerService.ts, .env.example |
| 3 | KMSService fail-fast em produção (SEC-01) | 8fd5b71 | src/services/KMSService.ts, src/server.ts, .env.example |

## What Changed

### QuantumSignerService.verifySignature (antes/depois)

**Antes (stub):**
```typescript
async verifySignature(_payload, _signatureBase64, _publicKeyHex): Promise<boolean> {
  // falcon-crypto v1.0.6 does not export verifyDetached.
  return true;  // VULNERABILIDADE: aceita qualquer assinatura
}
```

**Depois (Falcon-512 real):**
```typescript
async verifySignature(payload, signatureBase64, publicKeyHex): Promise<boolean> {
  const message = JSON.stringify(payload);
  const publicKeyB64 = Buffer.from(publicKeyHex, 'hex').toString('base64');
  return PostQuantumCrypto.verifySignatureFalcon512(message, signatureBase64, publicKeyB64);
}
```

### CircuitBreakerService.verifyAdminSignature (antes/depois)

**Antes (stub):**
```typescript
private async verifyAdminSignature(...): Promise<boolean> {
  if (!signature || signature.length < 10) return false;
  // TODO: Implement proper Falcon-512 signature verification
  return true;  // VULNERABILIDADE: aceita qualquer string >= 10 chars
}
```

**Depois (Falcon-512 real + env var enforcement):**
```typescript
private async verifyAdminSignature(action, chain, signature): Promise<boolean> {
  if (!signature || signature.trim().length === 0) return false;
  const adminPubKey = process.env.CIRCUIT_BREAKER_ADMIN_PUBKEY;
  if (!adminPubKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CIRCUIT_BREAKER_ADMIN_PUBKEY not configured in production');
    }
    console.warn('[CircuitBreaker] ...rejecting signature in fail-secure mode');
    return false;
  }
  return this.quantumSigner.verifySignature({ action, chain }, signature, adminPubKey);
}
```

### KMSService.getQuantumMasterKey (antes/depois)

**Antes:** gerava chave efêmera com apenas um `console.warn` em qualquer ambiente.

**Depois:** em `NODE_ENV=production` sem `QUANTUM_CERT_SECRET` lança:
```
Error: QUANTUM_CERT_SECRET is required in production — refusing to generate ephemeral Falcon master key
```

Em dev/test mantém o comportamento existente com o aviso.

### server.ts REQUIRED_ENV_VARS

Adicionado gate por NODE_ENV=production para:
- `QUANTUM_CERT_SECRET`
- `MP_WEBHOOK_SECRET`
- `CIRCUIT_BREAKER_ADMIN_PUBKEY`

## New Env Vars

| Var | Purpose | Required |
|-----|---------|----------|
| `CIRCUIT_BREAKER_ADMIN_PUBKEY` | Falcon-512 public key (hex) para verificar assinaturas do CircuitBreaker | Produção |
| `QUANTUM_CERT_SECRET` | Secret para derivar Falcon master key via HKDF | Produção (já existia, agora enforced) |

## Test Coverage

| File | Tests | Status |
|------|-------|--------|
| tests/quantum-signer-verify.test.ts | 4 | PASS |
| tests/circuit-breaker-security.test.ts | 5 | PASS |
| tests/post-quantum-crypto.test.ts | 4 (existente) | PASS |

**Total: 13 testes passando**

## Deviations from Plan

None — plano executado exatamente como descrito.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (Task 1) | c87531c — test(01-01) | PASSED |
| GREEN (Task 1) | 03d2898 — feat(01-01) | PASSED |
| RED (Task 2) | d45b571 — test(01-01) | PASSED |
| GREEN (Task 2) | ee32e2b — feat(01-01) | PASSED |

## Known Stubs

None — todos os stubs identificados foram eliminados neste plano.

## Threat Flags

None — todas as mitigações do threat model foram implementadas conforme planejado.

## Self-Check: PASSED

- [x] tests/quantum-signer-verify.test.ts existe
- [x] tests/circuit-breaker-security.test.ts existe
- [x] Commits c87531c, 03d2898, d45b571, ee32e2b, 8fd5b71 existem
- [x] `grep -c 'PostQuantumCrypto.verifySignatureFalcon512' src/services/QuantumSignerService.ts` = 1
- [x] `grep -c 'CIRCUIT_BREAKER_ADMIN_PUBKEY' src/services/CircuitBreakerService.ts` = 3
- [x] `grep -c 'QUANTUM_CERT_SECRET' src/server.ts` = 1
- [x] `npm run build` passa sem erros TypeScript
