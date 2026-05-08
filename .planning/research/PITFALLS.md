# Pitfalls Research

**Domain:** Backend SaaS multi-tenant — certificação de ativos via blockchain multi-chain, cron workers, PQC (Falcon-512), escrow time-lock, M2M/IoT event ingestion
**Researched:** 2026-05-08
**Confidence:** HIGH — baseado em auditoria direta do codebase (CONCERNS.md) + fontes externas verificadas

---

## Critical Pitfalls

### Pitfall 1: Master Key Efêmero em Produção (KMS)

**What goes wrong:**
Se `QUANTUM_CERT_SECRET` não estiver configurado ou tiver menos de 64 chars, `KMSService.getQuantumMasterKey()` gera um keypair Falcon-512 aleatório a cada cold start, cacheado só em memória. Em qualquer restart (deploy, crash, OOM), a chave some — e todas as private keys de wallets de tenants, derivadas dessa master key e encriptadas com ela, tornam-se permanentemente irrecuperáveis. Não há crash, não há alerta — apenas um `console.warn`.

**Why it happens:**
A env var foi marcada como `z.string().optional()` no schema Zod durante desenvolvimento para não quebrar ambientes locais sem a variável. A intenção era "configurar depois", mas o "depois" nunca chegou.

**How to avoid:**
- Mover `QUANTUM_CERT_SECRET` para required no `envSchema` (`src/config/env.ts`) — a aplicação deve recusar-se a iniciar sem ela
- Adicionar health check de startup que tenta unwrap de um ciphertext de teste com a master key — confirma que a chave está funcional antes de aceitar tráfego
- Nunca derivar ou encriptar chaves de tenants com um key material efêmero

**Warning signs:**
- `console.warn` no startup com menção a "ephemeral key"
- Wallets de tenants retornam erros de decryption após restart de servidor
- Testes de wallet funcionam em dev mas falham em staging

**Phase to address:**
Sub-sistema 3 (Pluggable DLT Workers) — antes de adicionar wallets Solana/Stellar derivadas da master key. Qualquer chain nova que use `deriveAndWrapPrivateKey` herda este bug imediatamente.

---

### Pitfall 2: Falcon-512 Verification é um Stub — CircuitBreaker é Bypassável

**What goes wrong:**
`QuantumSignerService.verifySignature()` sempre retorna `true`. `CircuitBreakerService.verifyAdminSignature()` aceita qualquer string com 10+ chars como assinatura Falcon válida. Qualquer holder de uma ADMIN API key pode pausar globalmente todas as chains sem possuir a chave privada Falcon do administrador.

**Why it happens:**
A integração com `liboqs` ou `oqs-node` foi adiada — o método `PostQuantumCrypto.verifySignatureFalcon512()` está implementado corretamente via `falcon.verifyDetached`, mas `QuantumSignerService` não delega a ele. A verificação real foi substituída por um placeholder que nunca foi removido.

**How to avoid:**
- `QuantumSignerService.verifySignature()` deve delegar a `PostQuantumCrypto.verifySignatureFalcon512()` — o método correto já existe
- Adicionar teste de regressão que verifica que uma assinatura forjada (string aleatória de 10 chars) é rejeitada
- `CIRCUIT_BREAKER_ADMIN_PUBKEY` deve ser required em produção

**Warning signs:**
- Comentário "// TODO: integrate real Falcon verify" no código
- Testes de CircuitBreaker passam com qualquer string como signature
- Nenhum erro ao tentar pausar chains com um token obviamente inválido

**Phase to address:**
Sub-sistema 1 (Core Gap Closure) — antes de qualquer deploy de produção. Este é o único pitfall que pode resultar em parada global da plataforma por um atacante com ADMIN key roubada.

---

### Pitfall 3: `dltTxId` Como Campo Polimórfico — Sentinel Values Vazam para Queries de Produto

**What goes wrong:**
`EventLog.dltTxId` serve quatro propósitos: (1) TX hash real on-chain, (2) `'PROCESSING'` como row lock, (3) `'RETRY_QUEUED'` como state flag, (4) `null` para não processado. Qualquer código que use `dltTxId` para construir explorer URLs, calcular métricas de anchoring ou exibir status ao tenant vai receber os sentinels e falhar silenciosamente. `DocumentVerificationFacet` já tem esse bug — `dltExplorerUrl` é sempre `null` porque o campo pode estar em estado sentinel.

**Why it happens:**
Row locking otimista em Postgres sem coluna de status dedicada. Usar um campo existente como sentinel é tentador porque evita migrations, mas viola o princípio de responsabilidade única do campo.

**How to avoid:**
- Adicionar coluna `anchorStatus` enum (`PENDING | LOCKING | ANCHORED | RETRY_QUEUED | FAILED_FUNDS`) em `EventLog`
- `dltTxId` fica reservado exclusivamente para TX hashes reais — nunca recebe string sentinel
- Row locking passa a usar `anchorStatus: LOCKING` em vez de `dltTxId: 'PROCESSING'`
- Criar migration e atualizar `AnchorQueueService` antes de adicionar novos adapters de chain

**Warning signs:**
- `dltExplorerUrl` retornando `null` no endpoint de verificação pública
- Queries em `EventLog` precisando excluir `'PROCESSING'` e `'RETRY_QUEUED'` explicitamente
- Novos devs surpresos ao descobrir que `dltTxId` não é sempre um hash

**Phase to address:**
Sub-sistema 1 (Core Gap Closure) — deve preceder Sub-sistema 3. Adicionar adapters Stellar/Solana com o campo polimórfico intacto multiplica a superficie de bug por N chains.

---

### Pitfall 4: `ChainTransaction` Logs com `tenantId: 'SYSTEM'` — Audit Trail Corrompido

**What goes wrong:**
Todos os adapters (`AlgorandAdapter`, `SolanaAdapter`, `SorobanAdapter`, `PolygonAdapter`, `EthAdapter`) registram `ChainTransaction` com `tenantId: 'SYSTEM'` hardcoded. `WalletService.getBalance()` agrega `ChainTransaction` para calcular balanço por tenant — mas todos os registros são do "SYSTEM", então o cálculo retorna dados incorretos para todos os tenants. O audit trail multi-chain é inútil para fins legais ou de compliance.

**Why it happens:**
Os adapters foram criados como serviços de infraestrutura sem contexto de tenant, seguindo o padrão de sistemas onde a chain é agnóstica de usuário. Em um sistema multi-tenant, o contexto precisa fluir do request até o adapter.

**How to avoid:**
- Estender `IDLTAdapter` para receber `tenantId` como parâmetro em `anchorEvent()` e `verifyAnchor()`
- `AnchorQueueService` já tem o `tenantId` do `EventLog` — passar para o adapter
- Nunca usar strings literais como `'SYSTEM'` em campos que deveriam ser foreign keys

**Warning signs:**
- `SELECT COUNT(*) FROM ChainTransaction WHERE tenantId != 'SYSTEM'` retorna 0 em produção
- Balanço de wallets de tenants calculado incorretamente
- Impossível gerar relatório de transações por tenant

**Phase to address:**
Sub-sistema 3 (Pluggable DLT Workers) — antes de habilitar qualquer chain além de Algorand em produção. Corrigir retroativamente o Algorand Adapter junto com a interface.

---

### Pitfall 5: `lastScannedBlock` em Memória — Depósitos Perdidos Após Restart

**What goes wrong:**
`BlockchainObserverService` armazena o último bloco EVM escaneado em uma `Map` de instância. Em restart, começa de `currentBlock - 100`. Na Polygon, 100 blocos equivalem a ~3 minutos. Se o servidor ficar offline por mais de 3 minutos (deploy, crash, OOM), todos os depósitos ocorridos durante esse intervalo são perdidos permanentemente — não há re-scan, não há recovery.

**Why it happens:**
Persistência do cursor de scan foi considerada prematura optimization durante o MVP. Para ambientes de dev com baixo volume, a janela de 100 blocos nunca é problema. Em produção com deploys frequentes, a janela é rotineiramente excedida.

**How to avoid:**
- Persistir `lastScannedBlock` por chain em uma tabela de sistema (`SystemConfig` ou `ChainCursor`)
- Em startup, ler o cursor persistido — nunca assumir `currentBlock - N` como ponto de partida seguro
- Adicionar alerta se a diferença entre `lastScannedBlock` e `currentBlock` exceder threshold configurável

**Warning signs:**
- Depósitos reportados por usuários que não aparecem no sistema
- Gap de tempo nos logs do Observer que coincide com janelas de deploy
- Balanço de wallets não bate com explorer on-chain

**Phase to address:**
Sub-sistema 3 (Pluggable DLT Workers) — junto com a implementação dos adapters Stellar/Solana. Cada nova chain adiciona um novo cursor de scan que precisa de persistência.

---

### Pitfall 6: Cron Worker Overlap — `AnchorQueueService` e `EscrowReleaseWorker` Sem Lock Distribuído

**What goes wrong:**
Em deploys com múltiplas instâncias (horizontal scaling ou rolling deploy no Dokploy), `SchedulerService` dispara `AnchorQueueService` em cada instância simultaneamente. O row lock (`dltTxId: 'PROCESSING'`) mitiga parcialmente o problema para o `AnchorQueueService`, mas o `EscrowReleaseWorker` não tem mecanismo de lock equivalente. O mesmo escrow pode ser liberado múltiplas vezes — com fundos transferidos múltiplas vezes.

**Why it happens:**
node-cron roda in-process — não tem coordenação entre instâncias. Em desenvolvimento com uma instância, o problema nunca aparece. Em produção com rolling deploy (duas instâncias ativas simultaneamente por ~30s), o overlap ocorre em toda atualização.

**How to avoid:**
- `EscrowReleaseWorker` precisa de advisory lock Postgres (`pg_try_advisory_lock`) antes de processar qualquer escrow
- Alternativamente, usar coluna `processingAt` com TTL para impedir re-entrada
- Para `AnchorQueueService`, o row lock existente é adequado — documentar explicitamente que ele é o mecanismo de coordenação
- Considerar mover para um job queue dedicado (Bull/BullMQ) se a escala exigir

**Warning signs:**
- Múltiplas liberações de escrow para o mesmo `assetId` nos logs
- `EventLog` com dois eventos `ESCROW_RELEASED` para o mesmo asset em timestamps próximos
- `dltTxId` de escrow mostrando duas transações diferentes para o mesmo asset

**Phase to address:**
Sub-sistema 5 (EscrowFacet + Time-Lock Oracle) — o lock deve ser parte do design inicial, não um patch posterior.

---

### Pitfall 7: KMS sem BIP-44 — Wallets Irrecuperáveis Fora da Plataforma

**What goes wrong:**
`KMSService.derivePrivateKey()` usa derivação bespoke: `keccak256(masterPrivateKey + accountIndex)` para EVM e derivação similar não-padrão para Algorand. Nenhum segue BIP-44. Se a plataforma parar de existir, se o tenant quiser migrar para outra custódia, ou se houver necessidade de recovery via hardware wallet — é impossível. A custódia é total e irrecuperável sem o master secret da Quantum Cert.

**Why it happens:**
Derivação bespoke é mais simples de implementar do que BIP-44 HD wallets. Em MVP, o objetivo é funcionar — portanto, qualquer derivação determinística parece suficiente.

**How to avoid:**
- Migrar para BIP-44: `m/44'/60'/0'/0/{index}` para EVM via `ethers.HDNodeWallet`, `m/44'/283'/0'/0/{index}` para Algorand
- Documentar o esquema de derivação na patente e nos termos de serviço — tenants precisam entender a natureza da custódia
- Antes de migrar, criar script de exportação que permite tenants extraírem suas private keys (consentimento explícito)

**Warning signs:**
- Impossível importar wallet derivada em Metamask ou Ledger
- Recovery de wallet requer acesso ao sistema da Quantum Cert
- Sem documentação do derivation path no código ou nos docs

**Phase to address:**
Sub-sistema 3 (Pluggable DLT Workers) — antes de habilitar wallets para Solana/Stellar. Cada chain nova criada com derivação bespoke aumenta o lock-in.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `as any` em queries Prisma (~40+ instâncias) | Evita reescrita de tipos ao mudar schema | Schema renames causam falhas silenciosas em runtime, não em compile time | Nunca em código de produção — indica Prisma client desatualizado ou middleware com type mismatch |
| `console.*` em vez de logger estruturado (205 calls) | Zero setup, simples | Impossível filtrar por tenant/severity em produção; debugging multi-tenant via grep | Apenas em scripts utilitários descartáveis |
| `DOCS_DEFAULT_API_KEY` pré-carregado na UI Scalar | Facilita onboarding de devs | Expõe API key funcional no browser em produção se a var estiver setada | Somente em ambientes de dev/staging com key read-only e sem dados reais |
| Sentinel values em `dltTxId` | Evita migration adicional | Queries de produto precisam conhecer e excluir sentinels; bugs silenciosos | Nunca — adicionar coluna de status é migration trivial |
| Ephemeral KMS master key como fallback | Não bloqueia dev sem `.env` | Perda total de todas as wallets em qualquer restart | Nunca em produção — deve ser startup crash |
| Explorer URL `algoexplorer.io` (shutdown 2023) | URL hardcoded simples | Todos os links de verificação pública estão quebrados | Nunca — URL morta desde 2023 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MercadoPago Webhook | Ler `MP_WEBHOOK_SECRET` de `process.env` diretamente sem validação Zod; não verificar HMAC | Adicionar ao `envSchema` como required; verificar HMAC com `crypto.timingSafeEqual()` contra raw body — nunca body parseado |
| MercadoPago Webhook | Processar evento antes de verificar assinatura | Verificação de assinatura DEVE ser o primeiro middleware — rejeitar antes de tocar em Prisma |
| MercadoPago Webhook | Armazenar `secretKey` de webhook de tenants em plaintext no DB | Encriptar com AES-256-GCM via `PostQuantumCrypto.wrapKey()` — o método existe |
| Algorand Anchoring | Usar `algoexplorer.io` para explorer URLs | Substituir por `https://allo.info/tx/{txId}` ou `https://explorer.perawallet.app/tx/{txId}` |
| Algorand Escrow | TEAL "escrow" que é só pagamento para si mesmo + DB record | TEAL real on-chain — a garantia de time-lock deve existir na blockchain, não só no banco |
| Solana/Stellar KMS | `derivePrivateKey()` joga erro para essas chains | Implementar derivação antes de qualquer wallet Solana/Stellar ser criada — erro em runtime é pior que erro em compile time |
| Document Verification | `(event as any).chain` — campo não existe em `EventLog` | Resolver chain via join com `Tenant.targetChain`; o select do Prisma não inclui o campo |
| Stellar SDK | SDK real em testes causa erros de rede/WASM | Mock global via `vitest.config.ts` alias já existe — manter padrão para todos os adapters |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `deposit.findMany` sem `take` em `WalletService.getBalance()` | Latência crescente em tenants ativos; picos de memória | `prisma.deposit.aggregate({ _sum: { amount: true } })` — agregação no banco, não no Node | ~1k depósitos por tenant |
| `deposit.findMany` sem limite em `BlockchainObserverService.checkConfirmations()` | Cada ciclo de 30s carrega mais rows; OOM eventual | `take: 100` + processamento paginado | ~5k deposits pendentes globais |
| IP rate limit Map sem cap em `server.ts` | Heap cresce sob DDoS de IPs únicos; cleanup O(n) em cada request | Cap de 50k entradas com LRU eviction, ou substituir por `express-rate-limit` (já é dependência) | ~50k IPs únicos simultâneos |
| Localização de `localKeyCache` em `PostQuantumCrypto` sem bound | Todas as private keys Falcon de todos os tenants ficam em heap indefinidamente | LRU cache com max 100 entradas + zeroize em eviction | Qualquer volume de tenants em processo long-running |
| `SecurityWatchdogService` soma `amount` em JavaScript (String → BigInt) | CPU spike em cada ciclo do watchdog; erros silenciosos em strings inválidas | Campo `amount` como `Decimal` no Postgres; `SUM` no banco | ~10k deposits na janela de 1 minuto |
| `WalletService.getQuantumAccount` com `include: { deposits: true }` | Query O(wallets × deposits) — memória e latência exponenciais | Retornar apenas saldos agregados; nunca arrays de deposits em chamadas de account summary | ~100 wallets por tenant com >100 deposits cada |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| CircuitBreaker aceita qualquer string 10+ chars como assinatura Falcon | Qualquer ADMIN key holder pode pausar toda a plataforma | Implementar verificação real via `PostQuantumCrypto.verifySignatureFalcon512()` — método já existe |
| `QuantumSignerService.verifySignature()` sempre `true` | Triple-signature escrow protocol não tem garantia criptográfica real | Delegar a `PostQuantumCrypto.verifySignatureFalcon512()` antes de qualquer deploy de escrow |
| `idempotencyGuard` usa `tenantId: 'anonymous'` como fallback | Cross-tenant replay de idempotency keys em rotas públicas | Rejeitar qualquer mutation sem `tenantId` autenticado — sem fallback silencioso |
| `TenantWebhook.secretKey` em plaintext no DB | Comprometimento do DB expõe todos os secrets de webhook de todos os tenants | Encriptar com `PostQuantumCrypto.wrapKey()` — AES-256-GCM já implementado |
| `DOCS_DEFAULT_API_KEY` exposta no browser via Scalar UI | API key funcional visível em devtools em produção | Nunca setar em produção; ou usar key read-only sem permissão de escrita |
| Agentes com `allowedSelectors: ['*']` não bloqueados | Wildcard poderia passar por includes check se implementado no futuro | Validar e rejeitar `'*'` em `allowedSelectors` no `AgentRegistryFacet` — documentar explicitamente |
| `EncodingSession` sem FK de tenant no schema Prisma | Cross-tenant isolation de sessions QTAG não enforçada no DB | Adicionar `@relation` a `Tenant` no schema; sem relação FK, cascade delete é impossível |
| `AuditLog.tenantId` como `String?` sem FK | Audit logs não podem ser cascade-deletados com o tenant; queries relacionais impossíveis | Adicionar `@relation` obrigatória a `Tenant` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Falcon-512 Verification:** `QuantumSignerService.verifySignature()` retorna `true` — verificar se delega a `PostQuantumCrypto.verifySignatureFalcon512()`
- [ ] **Escrow Algorand:** Métodos TEAL existem mas são simulação off-chain — verificar se há contrato on-chain real
- [ ] **Document Verification Explorer URL:** `dltExplorerUrl` provavelmente sempre `null` — verificar campo `chain` na query Prisma
- [ ] **MercadoPago Webhook:** Endpoint existe mas sem verificação HMAC visível — verificar se `MP_WEBHOOK_SECRET` está no schema Zod e se `timingSafeEqual` é usado
- [ ] **Stellar/Solana KMS:** `derivePrivateKey()` joga erro para essas chains — verificar antes de criar qualquer wallet nessas chains
- [ ] **E2E Tests:** `npm run test:e2e` referencia `tests/e2e.test.ts` que não existe — verificar se o script falha silenciosamente no CI
- [ ] **Coverage Thresholds:** Nenhum threshold configurado em `vitest.config.ts` — qualquer cobertura passa como "verde"
- [ ] **`AnchorQueueService` Real Path:** Só o stub mockado é testado — sem teste do path real de anchoring com adapter real
- [ ] **Polygon Contract Null Dereference:** `facetContract = null` se `POLYGON_TRANSFER_FACET_ADDRESS` não setado — verify startup validation
- [ ] **`lastScannedBlock` Persistence:** Após restart, scanner começa de `currentBlock - 100` — verificar se cursor é persistido em DB

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Master key efêmero perdido em produção | CATASTROPHIC | Não há recovery de wallets derivadas. Único caminho: tenants precisam gerar novas wallets e mover fundos manualmente — se tiverem acesso às chains. Prevenir é a única opção. |
| Depósitos perdidos por `lastScannedBlock` em memória | HIGH | Re-scan manual da blockchain a partir do bloco do último depósito conhecido — requer acesso de administrador ao nó. Para EVM, `eth_getLogs` com range específico. Para Algorand, indexer API. |
| Sentinel values em `dltTxId` em produção | MEDIUM | Migration: adicionar coluna `anchorStatus`; script de backfill que converte sentinels para o enum; rollback seguro pois `dltTxId` é preservado |
| `ChainTransaction` com `tenantId: 'SYSTEM'` em produção | MEDIUM | Script de backfill que correlaciona `ChainTransaction.txHash` com `EventLog.dltTxId` para recuperar `tenantId` correto — possível mas trabalhoso |
| Cron overlap liberando escrow múltiplas vezes | HIGH | Reverter transações on-chain é impossível. Compensação financeira manual. Prevenir com advisory lock antes de qualquer deploy com múltiplas instâncias. |
| Explorer URL morta (algoexplorer.io) | LOW | Substituição de URL em um arquivo — deploy em minutos |
| `as any` causando falha silenciosa após schema rename | MEDIUM | `npm run db:generate` + TypeScript strict mode revelará todos os pontos de falha — corrigir um a um |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Master key efêmero / KMS sem required env | Sub-sistema 1 (Core Gap Closure) | Startup sem `QUANTUM_CERT_SECRET` deve recusar-se a iniciar |
| Falcon-512 verify stub / CircuitBreaker bypass | Sub-sistema 1 (Core Gap Closure) | Teste de regressão: string forjada deve falhar `verifySignature()` |
| `dltTxId` sentinel values | Sub-sistema 1 (Core Gap Closure) | Migration com coluna `anchorStatus`; zero sentinels em `dltTxId` |
| MercadoPago webhook sem HMAC | Sub-sistema 1 (Core Gap Closure) | Request sem assinatura válida retorna 401, não 200 |
| `ChainTransaction tenantId: 'SYSTEM'` | Sub-sistema 3 (DLT Workers) | `SELECT COUNT(*) FROM ChainTransaction WHERE tenantId = 'SYSTEM'` retorna 0 |
| `lastScannedBlock` em memória | Sub-sistema 3 (DLT Workers) | Restart do servidor não perde mais de 1 bloco de scan |
| KMS sem BIP-44 / wallets irrecuperáveis | Sub-sistema 3 (DLT Workers) | Wallet derivada importável em Metamask/Ledger via seed phrase |
| Solana/Stellar KMS não implementado | Sub-sistema 3 (DLT Workers) | `derivePrivateKey('SOLANA', ...)` retorna chave válida, não erro |
| Cron overlap / EscrowReleaseWorker sem lock | Sub-sistema 5 (Escrow + Time-Lock) | Dois processos simultâneos não liberam o mesmo escrow duas vezes |
| TEAL escrow simulado / sem on-chain enforcement | Sub-sistema 5 (Escrow + Time-Lock) | Contrato TEAL real deployado; time-lock verificável no Algorand explorer |
| `deposit.findMany` sem limit | Infra & Ops (Produção) | Load test com 10k deposits mostra latência < 200ms em `getBalance()` |
| IP rate limit Map sem cap | Infra & Ops (Produção) | Heap estável sob DDoS simulado de 100k IPs únicos |
| Coverage sem thresholds | Sub-sistema 1 (Core Gap Closure) | `vitest.config.ts` com `coverage: { thresholds: { lines: 80 } }` |
| E2E tests inexistentes | Sub-sistema 2 (Document Verification) | `npm run test:e2e` executa com sucesso contra banco real |

---

## Sources

- CONCERNS.md (auditoria direta do codebase, 2026-05-08) — HIGH confidence, fonte primária
- TESTING.md (mapeamento de gaps de teste, 2026-05-08) — HIGH confidence, fonte primária
- [Idempotency in Distributed Systems](https://aloknecessary.github.io/blogs/idempotency-distributed-systems/) — padrões de idempotência em sistemas distribuídos
- [Dead Letter Queue Pattern](https://www.abstractalgorithms.dev/dead-letter-queue-pattern-poison-message-recovery) — poison message e retry storms
- [Node.js Cron Overlapping Tasks](https://medium.com/@shriharimohan/node-js-cron-handling-overlapping-tasks-like-a-noob-d8627b493496) — overlap de cron workers
- [Webhook Security Guide: HMAC & Replay Protection](https://www.hooklistener.com/learn/webhook-security-fundamentals) — timing attacks e replay em webhooks
- [Webhook Signature Verification 2026](https://hookray.com/blog/webhook-signature-verification-2026) — raw body requirement, common mistakes
- [Multi-Tenant Audit Logging Architecture Mistakes](https://dev.to/robertatkinson3570/multi-tenant-audit-logging-the-architecture-mistakes-we-made-3m8f) — tenant isolation em audit logs
- [Multi-Tenant Leakage: Row-Level Security Failures](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c) — cross-tenant data exposure patterns
- [Falcon — Open Quantum Safe](https://openquantumsafe.org/liboqs/algorithms/sig/falcon.html) — side-channel resistance, deployment challenges
- [Algorand + Falcon Technical Brief](https://algorand.co/blog/technical-brief-quantum-resistant-transactions-on-algorand-with-falcon-signatures) — Falcon em contexto Algorand
- [Bitcoin Derivation Paths](https://www.unchained.com/blog/bitcoin-derivation-paths) — BIP-44 e riscos de derivação bespoke
- [Crypto Custody Guide — Stripe](https://stripe.com/resources/more/crypto-custody) — omnibus custody risks

---

*Pitfalls research para: Backend SaaS multi-tenant blockchain/DLT*
*Researched: 2026-05-08*
