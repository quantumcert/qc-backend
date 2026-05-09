# ROADMAP — Quantum Cert Backend
_Generated: 2026-05-08 | Granularity: standard | Mode: mvp_
_Coverage: 36/36 v1 requirements mapped_

---

## Phases

- [ ] **Phase 1: Core Gap Closure + Production Hardening** — Fechar falhas de segurança críticas e conectar features inacessíveis antes de qualquer expansão
- [ ] **Phase 2: Document Verification + QTAG Production** — Verificação pública de documentos e NFC commissioning funcionando em produção
- [ ] **Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority** — Adapter Stellar para hackathon + infraestrutura multi-chain
- [ ] **Phase 4: Scale + Observability Infrastructure** — Redis, Pino, Sentry, BullMQ — plataforma multi-instância pronta para carga real
- [ ] **Phase 5: EscrowFacet + Time-Lock Oracle + M2M** — Escrow on-chain com time-lock e registro de agentes IoT

---

## Phase Details

### Phase 1: Core Gap Closure + Production Hardening
**Goal**: A plataforma opera sem riscos catastróficos — chaves Falcon persistidas, verificação real implementada, circuit breaker seguro, e todas as features existentes alcançáveis via Diamond
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06
**Success Criteria** (what must be TRUE):
  1. Um restart do servidor não invalida chaves Falcon de nenhum tenant — wallets permanecem acessíveis após reinicialização
  2. Um ADMIN não consegue acionar o CircuitBreaker com token inválido — o endpoint rejeita qualquer assinatura Falcon forjada
  3. Dois workers executando `AnchorQueueService` simultaneamente não processam o mesmo `EventLog` — distributed lock garante exclusão mútua
  4. Um request `POST /api/v1/diamond` com selector `document.verify` retorna resultado (não 404) — `DocumentVerificationFacet` está registrado no `FacetRegistry`
  5. Uma transição de estado inválida (ex: `BURNED → ACTIVE`) é rejeitada com 422 — `LifecycleFacet` enforce as regras de estado; contribuições de não-auditores entram em fila `PENDING_REVIEW` e são visíveis para aprovação
**Plans**: TBD

### Phase 2: Document Verification + QTAG Production
**Goal**: Qualquer pessoa pode verificar a autenticidade de um documento via hash público, e NFC commissioning funciona em produção com KMS real
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DOC-01, DOC-02, DOC-03, QTAG-01, QTAG-02
**Success Criteria** (what must be TRUE):
  1. Um usuário anônimo pode fazer `GET /api/v1/verify/document/{sha3-512-hash}` e receber metadados de ancoragem (txId, chain, timestamp) sem precisar de API key
  2. O response de verificação pública não expõe dados sensíveis do tenant — apenas campos públicos definidos (nome, chain, txId)
  3. Um QTAG físico pode ser comissionado em produção — `CommissioningFacet` usa KMS production path, não dev stub
  4. Um QTAG suspeito é rejeitado na verificação — `SDMVerifier` detecta tags não-autênticas e retorna erro de autenticidade
**Plans**: TBD
**UI hint**: no

### Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority
**Goal**: Tenants podem ancorar eventos em Stellar (hackathon) e a infraestrutura multi-chain está pronta para adicionar novas chains sem tocar no core
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DLT-01, DLT-02, DLT-03, DLT-04, DLT-05
**Success Criteria** (what must be TRUE):
  1. Um tenant com `targetChain: stellar` tem seus `EventLog` records ancorados em Stellar — txId da Stellar gravado em `ChainTransaction`
  2. Um tenant com `targetChain: algorand` continua funcionando sem alteração — o adapter Algorand existente não foi modificado
  3. Um restart do servidor não perde confirmações de transações pendentes — `lastScannedBlock` é lido do banco, não de estado in-memory
  4. Queries por tenant em `ChainTransaction` retornam apenas registros daquele tenant — `tenantId` está persistido na tabela
**Plans**: TBD

### Phase 4: Scale + Observability Infrastructure
**Goal**: A plataforma opera corretamente em múltiplas instâncias simultâneas com observabilidade de produção completa
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07
**Success Criteria** (what must be TRUE):
  1. Duas instâncias do servidor em rolling deploy compartilham o mesmo estado de rate limiting e idempotency — nenhum request passa duas vezes nem é bloqueado incorretamente
  2. Todos os logs da plataforma aparecem em formato JSON estruturado com campos `tenantId`, `requestId`, `level` — nenhuma chamada `console.*` permanece
  3. Uma exceção não tratada em produção gera um evento Sentry com contexto de tenant e request — diagnóstico sem acesso ao servidor
  4. Um job de anchoring que falha é reenfileirado automaticamente pelo BullMQ — sem perda de eventos financeiros por fire-and-forget
  5. O endpoint `GET /health` retorna profundidade da fila AnchorQueue e status das DLT connections — operador monitora sem acessar banco diretamente
**Plans**: TBD

### Phase 5: EscrowFacet + Time-Lock Oracle + M2M
**Goal**: Assets podem ser travados em escrow on-chain com liberação automática por tempo, e dispositivos IoT autenticados podem injetar eventos com assinatura Falcon
**Mode:** mvp
**Depends on**: Phase 3, Phase 4
**Requirements**: ESC-01, ESC-02, ESC-03, ESC-04, ESC-05, M2M-01, M2M-02, M2M-03
**Success Criteria** (what must be TRUE):
  1. Um asset em estado `LOCKED_IN_ESCROW` não aceita nenhuma mudança de estado antes do `unlockTimestamp` — todas as tentativas retornam 409
  2. Após `unlockTimestamp` expirar, o `EscrowReleaseWorker` libera o asset automaticamente — em rolling deploy com duas instâncias, o mesmo escrow é liberado exatamente uma vez
  3. A lógica de liberação do escrow é executada no smart contract on-chain (TEAL) — não off-chain via cron apenas
  4. Um dispositivo IoT autenticado pode submeter `POST /api/v1/agent/event` com payload Falcon-512 assinado — payload inválido é rejeitado com 401
  5. Um agente não registrado para o tenant não consegue injetar eventos — `AgentRegistryFacet` valida pertencimento antes de processar
**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Gap Closure + Production Hardening | 0/? | Not started | - |
| 2. Document Verification + QTAG Production | 0/? | Not started | - |
| 3. Pluggable DLT Workers — Stellar/Soroban Priority | 0/? | Not started | - |
| 4. Scale + Observability Infrastructure | 0/? | Not started | - |
| 5. EscrowFacet + Time-Lock Oracle + M2M | 0/? | Not started | - |
