# Research Summary — Quantum Cert Backend
_Synthesized: 2026-05-08 | Sources: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md_

## Executive Summary

O qc-backend tem o core funcionando (registro de ativo, audit trail, ancoragem Algorand, RBAC, multi-tenancy, curation layer). A arquitetura Diamond Pattern + IDLTAdapter como seam hexagonal está correta e não deve ser alterada. O trabalho dos próximos milestones é **hardening + expansão incremental**, não construção do zero.

**Dois pitfalls têm consequências catastróficas/irreversíveis** e devem ser corrigidos antes de qualquer outra coisa:

1. `QUANTUM_CERT_SECRET` como env var opcional gera chave Falcon **efêmera** a cada restart — perda irrecuperável de todas as wallets de tenants
2. `QuantumSignerService.verifySignature()` sempre retorna `true` — qualquer ADMIN key holder pode pausar globalmente toda a plataforma via CircuitBreaker

---

## Stack Recommendations

| Área | Recomendação | Confiança |
|------|-------------|-----------|
| Stellar/Soroban SDK | `@stellar/stellar-sdk ^14.6.1` (SorobanRpc reorganizado, `js-soroban-client` depreciado) | Alta |
| Job queue (financeiro) | BullMQ + Redis (jobs de escrow não podem ser perdidos) | Alta |
| Logging | Pino (205 `console.*` calls para substituir) | Alta |
| Error tracking | Sentry | Alta |
| Rate limiting prod | Redis (in-memory quebra em multi-instância/rolling deploy) | Alta |
| PQC library | `falcon-crypto` atual — monitorar Open Quantum Safe migration | Média |

---

## Table Stakes (must-haves para produção)

- Chave Falcon persistida em KMS ou secret vault (não env var efêmera)
- Verificação de assinatura Falcon real (não stub `return true`)
- Circuit breaker com RBAC correto
- `dltTxId` sentinel único (colisões em multi-worker)
- Idempotency com Redis (não in-memory)
- `DocumentVerificationFacet` registrado no FacetRegistry (hoje unreachable)
- Testes E2E (inexistentes atualmente)

## Differentiators

- Multi-chain com IDLTAdapter (zero mudança no core ao adicionar chains)
- Falcon-512 embarcado no note field (sem smart contract)
- Curation layer com approval workflow
- M2M/IoT com Falcon-signed payloads
- Escrow on-chain com time-lock oracle

---

## Critical Pitfalls

### P1 — CATASTRÓFICO: Falcon key efêmera
**Symptom:** `QUANTUM_CERT_SECRET` opcional → nova chave a cada restart → wallets de tenants inacessíveis
**Fix:** KMS obrigatório antes de qualquer dado real em produção
**Phase:** 1 (blocker absoluto)

### P2 — CATASTRÓFICO: verifySignature sempre true
**Symptom:** CircuitBreaker pode ser acionado por qualquer ADMIN → plataforma inteira offline
**Fix:** Implementar verificação Falcon real
**Phase:** 1 (blocker absoluto)

### P3 — ALTO: dltTxId sentinel colide em multi-worker
**Symptom:** `'PROCESSING'` como string sentinel → dois workers processam o mesmo EventLog
**Fix:** `pg_advisory_lock` ou UUID único por worker
**Phase:** 1

### P4 — ALTO: `tenantId` não persistido em ChainTransaction
**Symptom:** Cross-chain queries impossíveis, billing por tenant inviável
**Fix:** Adicionar `tenantId` no schema antes de escalar
**Phase:** 1-2

### P5 — ALTO: in-memory state quebra em multi-instância
**Symptom:** Rate limiter, idempotency, CircuitBreaker state perdido em rolling deploy
**Fix:** Redis para todo state compartilhado
**Phase:** 4

### P6 — ALTO: Soroban contract ABI vs adapter
**Symptom:** `SorobanAdapter.ts` pode invocar métodos com assinaturas incorretas
**Fix:** Validar ABI do contract contra adapter antes de deploy
**Phase:** 3 (requer research-phase)

### P7 — MÉDIO: BIP-44 migration para wallets Algorand existentes
**Symptom:** Derivation path mudando quebra wallets já registradas
**Fix:** Planejar migration path antes de implementar
**Phase:** 3 (requer research-phase)

### P8 — MÉDIO: EscrowReleaseWorker sem distributed lock
**Symptom:** Rolling deploy → mesmo escrow liberado múltiplas vezes on-chain (irreversível)
**Fix:** `pg_try_advisory_lock` no worker
**Phase:** 5

---

## Suggested Build Order (5 Phases)

### Phase 1: Core Gap Closure + Production Hardening
Fechar falhas de segurança críticas (KMS obrigatório, Falcon verify real, CircuitBreaker, sentinel dltTxId) e conectar features inacessíveis (DocumentVerificationFacet no FacetRegistry, LifecycleFacet, SchedulerService, Curation Layer). **Pré-requisito absoluto de tudo.**

### Phase 2: Document Verification + QTAG Production
DocumentVerification já tem implementação parcial — apenas conectar. CommissioningFacet KMS production path desbloqueia NFC em produção. Alto delta entre "parece pronto" e "realmente funciona".

### Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority
Hackathon Stellar tem deadline externo. Inclui fixes de infra que toda chain nova herda (tenantId real no ChainTransaction, BIP-44 derivation, lastScannedBlock persistido em DB). **Requer research-phase** (Soroban contract ABI + BIP-44 migration strategy).

### Phase 4: Scale + Observability Infrastructure
Redis para idempotency/rate limiting; pino para 205 console.* calls; BullMQ para workers financeiros; Sentry para error tracking. Padrão estabelecido — pode pular research-phase.

### Phase 5: EscrowFacet + Time-Lock Oracle + M2M Hardening
TEAL escrow on-chain real (hoje simulação off-chain); EscrowReleaseWorker com pg_try_advisory_lock; M2M AgentRegistryFacet com Falcon verify real; triple-sign. **Requer research-phase** (TEAL escrow on-chain — smart contract requer auditoria de segurança).

---

## Research Flags

**Precisam de `/gsd-research-phase`:**
- Phase 3: Soroban contract ABI vs SorobanAdapter.ts + BIP-44 migration strategy com wallets existentes
- Phase 5: TEAL escrow on-chain (smart contract requer auditoria de segurança)

**Podem pular research-phase:**
- Phase 1: Fixes cirúrgicos definidos pelo CONCERNS.md — escopo claro
- Phase 4: pino/Sentry/BullMQ — documentação excelente, integrações padrão

---

## Confidence

**Overall: ALTA**

**Gaps conhecidos:**
- Soroban contract ABI não verificado contra adapter existente
- BIP-44 migration path para wallets Algorand já derivadas não mapeado
- E2E test suite inexistente (`tests/e2e.test.ts` não existe)
- `falcon-crypto` manutenção a longo prazo (biblioteca menor, não Open Quantum Safe oficial)
