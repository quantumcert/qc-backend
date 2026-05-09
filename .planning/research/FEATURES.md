# Feature Research

**Domain:** Backend SaaS multi-tenant — certificação de ativos físicos e digitais via blockchain + criptografia pós-quântica
**Researched:** 2026-05-08
**Confidence:** MEDIUM-HIGH (competitive landscape via WebSearch verificado contra múltiplas fontes; features existentes no codebase HIGH confidence por leitura direta)

---

## Feature Landscape

### Table Stakes (Clientes esperam que existam)

Features que qualquer plataforma de certificação/autenticação de ativos deve ter. Ausência = produto incompleto.

| Feature | Por que é esperada | Complexidade | Status no codebase | Notas |
|---------|-------------------|--------------|-------------------|-------|
| Registro de ativo com ID único | Base de toda certificação — sem registro não há certificado | LOW | DONE (`asset.create`, `AssetRegistryFacet`) | Metadata opaco, `publicUrl` permanente |
| Audit trail imutável por ativo | Compliance exige rastreabilidade completa — clientes jurídicos, regulatórios e de alta-valor | MEDIUM | DONE (`EventLog`, append-only) | SHA3-512 no payload; âncora DLT |
| Ancoragem on-chain com prova verificável | A proposta de valor central — sem blockchain é só um banco de dados | HIGH | DONE (`AnchorQueueService`, `AlgorandAnchorFacet`) | FIFO, row-lock atômico, batch 10 |
| Verificação pública sem autenticação | Compradores, auditores externos e consumidores precisam verificar sem ter conta | LOW | DONE (`GET /api/v1/verify/document`, `GET /api/v1/scan`) | Endpoint público; sem auth |
| Ciclo de vida de ativo com estados auditados | Compliance e transferência de propriedade exigem rastreamento de estados | MEDIUM | DONE (`LifecycleFacet`, state machine: DRAFT→ACTIVE→SUSPENDED→ARCHIVED→BURNED) | Transições por role |
| Autenticação por API key com RBAC | Clientes SaaS B2B esperam auth por chave de API e controle granular de permissões | MEDIUM | DONE (`requireApiKey`, roles ADMIN/OPERATOR/READER) | Bcrypt hash; raw key only on creation |
| Rate limiting por plano | Tenants pagam tiers — sem rate limiting não há produto B2B viável | MEDIUM | DONE (`RateLimiterFacet`, Postgres-backed por plano) | IP-level + per-tenant |
| Multi-tenancy com isolamento completo | SaaS implica múltiplos clientes; vazamento entre tenants é breach crítico | HIGH | DONE (`secureContext`, Prisma sempre scoped por tenantId) | Cross-tenant impossível no query level |
| Webhook para notificações de eventos | Clientes precisam integrar em seus próprios sistemas (ERPs, dashboards, alertas) | MEDIUM | DONE (`WebhookDispatcher`, `TenantWebhook`) | Webhook secret em plaintext — risco HIGH; ver CONCERNS |
| Histórico de propriedade (ownership chain) | Buyers e auditores externos precisam ver quem possuiu o ativo e quando | MEDIUM | DONE (`asset.addOwner`, `EventLog`) | Registo por evento no log |
| Idempotência em mutations | Clientes de API B2B precisam de garantias de exatamente-uma-vez em operações críticas | LOW | DONE (`X-Idempotency-Key`, 24h TTL) | In-memory — não escala multi-instância |
| Transferência de ativo entre owners | Plataformas de certificação sem transferência bloqueiam o mercado secundário dos clientes | MEDIUM | DONE (`transfer.initiate`, `TransferRegistryFacet`) | Estado AWAITING_PAYMENT intermediário |
| Documentação de API interativa | Clientes B2B avaliam plataformas pela qualidade da documentação antes de contratar | LOW | DONE (Scalar via `docsRoutes`) | Cuidado: `DOCS_DEFAULT_API_KEY` exposta em produção |
| Filtro de dados públicos por ativo | Cada tenant decide o que expõe publicamente — privacidade diferencial por campo | MEDIUM | DONE (`publicDataKeys` em Asset, `PublicProfileFacet`) | — |

---

### Differentiators (Vantagem competitiva)

Features que diferenciam da commodity. Não são esperadas pelo mercado, mas são valorizadas.

| Feature | Proposta de valor | Complexidade | Status no codebase | Notas |
|---------|-------------------|--------------|-------------------|-------|
| Assinatura pós-quântica (Falcon-512) | Única plataforma de certificação com PQC embarcado no txn on-chain — resistente a ataques quânticos. Gartner: criptografia clássica unsafe by 2029. | HIGH | PARTIAL (signing OK em `PostQuantumCrypto`; `QuantumSignerService.verifySignature()` sempre retorna `true` — ver CONCERNS) | NIST finalizou PQC standards em ago/2024. Diferenciador real, não marketing. |
| NFC anti-replay com CMAC rolling (QTAG) | Hardware-bound authentication — impossível clonar tag sem acesso ao chip. Endereça falsificação física, não só digital. | HIGH | DONE (`CommissioningFacet`, `SDMVerifierService`, `DeviceGuardFacet`, contador monotônico) | KMS production path ainda é TODO em CommissioningFacet |
| Multi-chain com arquitetura plugável | Clientes escolhem chain (Algorand, Solana, Stellar, Polygon, ETH) — não ficam presos a um único L1. Raro em plataformas de certificação. | HIGH | PARTIAL (5 adapters implementados; Solana/Stellar KMS derivation TODO; TEAL escrow apenas simulado) | `IDLTAdapter` é a abstração correta — adicionar chain = novo adapter |
| Escrow com time-lock on-chain | Bloqueia transferência de ativo até condição temporal — garante liquidação programada sem intermediário. Diferenciador para mercado de luxo/leilão. | HIGH | PARTIAL (`EscrowFacet` implementado; Algorand TEAL é placeholder — não é on-chain real) | Multi-sig `tripleSign` (Seller + Buyer + QC Authority) presente na interface |
| Agentes IoT/M2M com assinatura Falcon-512 | Dispositivos industriais assinam eventos diretamente — sem humano no loop. Diferenciador para manufatura, cold chain, rastreabilidade automatizada. | HIGH | DONE (`AgentRegistryFacet`, `requireAgentSignature`, `POST /api/v1/agent/event`) | `allowedSelectors` por agente limita escopo de ação |
| Curation layer (fila de aprovação para não-auditores) | Permite contribuições de terceiros sem comprometer integridade do registro — modelo de "confiança escalada". Específico para plataformas de auditoria/certificação. | MEDIUM | DONE (`event.suggestPublic` → `PENDING`; `event.review` → `APPROVED/REJECTED`) | Issue #7 implementado |
| Omnibus wallet (custódia sem Web3 wallet) | Tenants usam a plataforma sem possuir uma wallet blockchain — master wallet paga fees. Elimina a maior barreira de entrada Web3. | HIGH | DONE (`ALGORAND_MASTER_MNEMONIC`, `AnchorQueueService`) | Key derivation não segue BIP-44 — risco de lock-in de custódia |
| Verificação de documento por hash (ZK-like) | Auditores e consumidores verificam autenticidade de PDF/relatório sem receber o documento — privacy-preserving verification. | MEDIUM | PARTIAL (`DocumentVerificationFacet` implementado mas não registrado no `FacetRegistry`; `chain` field missing; explorer URL morta) | `documentHash` = SHA3-512 do documento off-chain |
| Watchdog de segurança com detecção de anomalias | Alertas automáticos para spikes de volume, falhas DLT, comportamento suspeito — produção auto-monitorada. | HIGH | PARTIAL (`SecurityWatchdogService` existe; `Sinarca` integration comentada; logging não estruturado) | `PanicLog` model presente |
| Circuit breaker global por chain | Pausa operações de ancoragem por chain em emergência — controle de risco operacional. | MEDIUM | PARTIAL (implementado; admin signature verification é stub — qualquer string >= 10 chars passa) | Risco de segurança CRÍTICO antes de produção |
| Blockchain observer para depósitos de stablecoin | Detecta pagamentos on-chain sem gateway de pagamento centralizado — permite billing crypto-native. | HIGH | PARTIAL (`BlockchainObserverService`; `lastScannedBlock` in-memory — perde eventos após restart) | Persiste último bloco escaneado no DB |

---

### Anti-Features (Não construir deliberadamente)

| Anti-Feature | Por que é solicitada | Por que é problemática | O que fazer em vez |
|--------------|---------------------|----------------------|-------------------|
| Custódia de ativos físicos | "Guardem o produto certificado" parece extensão natural | Cria obrigações legais de guarda, seguro, logística — muda completamente o modelo de negócio | Certificar, não custodiar. Deixar explícito no contrato de uso. |
| Smart contract próprio em cada chain | "Quero controle total" — parece mais robusto | Custo de auditoria por chain, complexity de manutenção por fork, latência de deploy. Falcon-512 no `note` field é mais portável e mais barato. | Manter abordagem atual: txn com note field + `IDLTAdapter`. Escrow TEAL em Algorand é exceção justificada. |
| Marketplace integrado (compra/venda de ativos) | Clientes querem monetizar ativos certificados diretamente na plataforma | Regulação financeira (securities, KYC/AML), risco de custódia de fundos, foco de produto. Muda de plataforma de certificação para exchange. | Fornecer APIs de transferência de propriedade que um marketplace externo pode consumir. |
| Frontend white-label embutido no backend | Tenants querem uma UI customizável "out of the box" | Aumenta a surface de manutenção, conflita com separação de responsabilidades, multi-repo é a decisão tomada | `qc-dashboard`, `qc-home`, `qc-record-module` são os repos de UI — backend só expõe APIs |
| Interpretação de metadata no core | "Entenda que esse campo é preço / serial / lote" | Viola o Golden Rule — core agnóstico é o que permite white-label e extensibilidade sem rewrite | `Asset.metadata` e `EventLog.payload` são blobs opacos; SHA3-512 para ancoragem; semântica é responsabilidade do tenant |
| Operação de nó blockchain próprio | "Não quero depender de terceiros" | Custo operacional alto, expertise DevOps de blockchain, fora do core competency da plataforma | `ALGOD_SERVER` e equivalentes: nós hospedados (Nodely, QuickNode, etc.) |
| Login social / OAuth para usuários finais | "Consumidores precisam criar conta" | Consumidores verificam via QR/NFC público — não precisam de conta. Criar auth B2C adiciona LGPD/GDPR surface. | Verificação pública sem conta. Transferência de ownership via email/identificador simples. |
| Real-time sync via WebSocket | "Atualizações em tempo real no dashboard" | Ancoragem DLT é assíncrona por natureza (30s cycle). WebSocket cria pressão de conexão permanente sem ganho real. | Webhooks push quando âncora completa. Cliente faz polling se precisar de status. |

---

## Feature Dependencies

```
[Registro de Ativo]
    └──required by──> [Audit Trail / EventLog]
    └──required by──> [Ciclo de Vida]
    └──required by──> [Transferência de Propriedade]
    └──required by──> [Ancoragem DLT]
    └──required by──> [NFC Anti-replay (QTAG)]
    └──required by──> [Verificação Pública]

[Ancoragem DLT]
    └──required by──> [Verificação de Documento por Hash]
    └──required by──> [Escrow com Time-Lock]
    └──required by──> [Multi-chain]

[NFC Anti-replay (QTAG)]
    └──requires──> [Commissioning Facet + KMS production path]  ← TODO crítico

[Assinatura Falcon-512 (signing)]
    └──required by──> [Agentes IoT/M2M]
    └──required by──> [Circuit Breaker admin auth]  ← stub hoje
    └──required by──> [Escrow triple-sign]

[Assinatura Falcon-512 (verification)]
    └──requires──> [oqs-node / liboqs integration]  ← QuantumSignerService retorna true sempre

[Multi-tenancy + RBAC]
    └──required by──> [Tudo] — fundação da plataforma

[Webhook]
    └──enhances──> [Ancoragem DLT] — notifica tenant quando txn confirma
    └──enhances──> [Curation Layer] — notifica tenant de evento pendente
    └──enhances──> [Transferência] — notifica partes da mudança de estado

[Omnibus Wallet]
    └──required by──> [Tenants sem Web3 wallet usarem ancoragem]
    └──requires──> [KMS + BIP-44 derivation]  ← derivação atual não é BIP-44

[Escrow Time-Lock]
    └──requires──> [Ciclo de Vida] — estado LOCKED_IN_ESCROW
    └──requires──> [Ancoragem DLT] — garantia on-chain real (TEAL é placeholder)
    └──requires──> [Falcon-512 verification real] — triple-sign não é verificado hoje

[Curation Layer]
    └──requires──> [RBAC] — auditor (ADMIN) aprova; não-auditor sugere
    └──requires──> [Audit Trail] — eventos PENDING antes de APPROVED
    └──enhances──> [Ancoragem DLT] — só ancora eventos APPROVED

[Agentes IoT/M2M]
    └──requires──> [Falcon-512 verification real]
    └──requires──> [RBAC] — agent key = OPERATOR role
    └──enhances──> [Audit Trail] — eventos automatizados sem humano no loop

[Blockchain Observer]
    └──required by──> [MercadoPago webhook] — fallback para pagamento crypto-native
    └──requires──> [Persistência de lastScannedBlock]  ← in-memory hoje

[Verificação de Documento por Hash]
    └──requires──> [DocumentVerificationFacet registrado em FacetRegistry]  ← não está hoje
    └──requires──> [chain field no EventLog query]  ← cast as any hoje
    └──requires──> [Explorer URL válida]  ← algoexplorer.io morto

[PQC como diferenciador de mercado]
    └──requires──> [Falcon-512 verification funcional]  ← gap crítico antes de qualquer claim de marketing
```

### Notas de Dependência Críticas

- **Falcon-512 verification real** é pré-requisito de todos os claims PQC: AgentRegistryFacet, EscrowFacet triple-sign, CircuitBreaker admin. Enquanto `QuantumSignerService.verifySignature()` retorna `true`, PQC é somente signing, não verification.
- **DocumentVerificationFacet** está implementado mas não registrado no `FacetRegistry` — feature publicamente prometida mas inacessível via API.
- **CommissioningFacet KMS production path** desbloqueia QTAGs em produção; sem isso, NFC commissioning é dev-only.
- **Explorer URL morta** (algoexplorer.io) quebra silenciosamente o painel de transparência pública — fix LOW effort, HIGH impact na percepção.

---

## MVP Definition

> Contexto: backend existente tem core funcionando. "MVP" aqui significa o conjunto mínimo para um tenant produtivo gerar valor real.

### Pronto para uso produtivo (já existe — validar e hardear)

- [x] Registro de ativo com metadata opaco — existente
- [x] Audit trail imutável com ancoragem Algorand — existente
- [x] Verificação pública por hash — existente (fix urgente: explorer URL + FacetRegistry gap)
- [x] Multi-tenancy com isolamento completo — existente
- [x] RBAC ADMIN/OPERATOR/READER — existente
- [x] Webhook para notificações — existente (fix: secretKey em plaintext)
- [x] Ciclo de vida de ativo — existente
- [x] Curation layer (issue #7) — existente

### Adicionar para produção confiável (gaps críticos)

- [ ] Falcon-512 verification real (`oqs-node` integration) — PQC como claim de marketing requer isso
- [ ] CommissioningFacet KMS production path — QTAGs em produção
- [ ] `anchorStatus` enum em EventLog (separar sentinel values de TX hashes)
- [ ] Explorer URL válida (Pera Wallet ou allo.info)
- [ ] `DocumentVerificationFacet` registrado no FacetRegistry
- [ ] `QUANTUM_CERT_SECRET` como env var obrigatória (não opcional)
- [ ] Webhook secretKey encrypted at rest
- [ ] BIP-44 key derivation (replace bespoke scheme)

### Adicionar após validação (v1.x)

- [ ] Soroban/Stellar adapter completo — desbloqueado por hackathon
- [ ] Solana KMS key derivation
- [ ] Persistência de `lastScannedBlock` (BlockchainObserver)
- [ ] Redis para idempotency store (multi-instância)
- [ ] Rate limiting com LRU cap (replace in-memory unbounded map)
- [ ] Logging estruturado (pino/winston — 205 console.* calls)
- [ ] ChainTransaction com `tenantId` real (replace hardcoded `'SYSTEM'`)
- [ ] MercadoPago webhook com HMAC verification real

### Futuro / v2+

- [ ] TEAL escrow on-chain real (Algorand smart contract auditado)
- [ ] Escrow triple-sign com Falcon-512 verification funcional
- [ ] Sinarca integration (anomaly detection)
- [ ] Metered billing com usage dashboards por tenant
- [ ] Self-service tenant onboarding (hoje é manual via seed)
- [ ] Digital Product Passport compliance (EU DPP regulations)

---

## Feature Prioritization Matrix

| Feature | Valor para o Usuário | Custo de Implementação | Prioridade |
|---------|---------------------|----------------------|------------|
| Falcon-512 verification real | HIGH (diferenciador core) | MEDIUM (oqs-node binding) | P1 |
| Explorer URL corrigida | HIGH (confiança pública) | LOW (one-liner) | P1 |
| DocumentVerificationFacet no FacetRegistry | HIGH (feature prometida inacessível) | LOW (adicionar uma linha) | P1 |
| QUANTUM_CERT_SECRET como required | HIGH (evita catástrofe de produção) | LOW (env.ts change) | P1 |
| CommissioningFacet KMS production | HIGH (NFC em produção) | HIGH (KMS tenant-scoped key) | P1 |
| Webhook secretKey encrypted | HIGH (segurança de tenant data) | MEDIUM (AES-256-GCM já disponível) | P1 |
| `anchorStatus` enum no EventLog | MEDIUM (type safety + bug fix) | MEDIUM (migration + refactor) | P2 |
| BIP-44 key derivation | MEDIUM (custody recovery) | HIGH (migração com cuidado) | P2 |
| ChainTransaction com tenantId real | MEDIUM (audit trail correto) | MEDIUM (IDLTAdapter interface change) | P2 |
| Soroban adapter completo | HIGH (hackathon deadline) | HIGH | P1 (por deadline externo) |
| Redis idempotency | MEDIUM (scale horizontal) | LOW | P2 |
| Structured logging | MEDIUM (ops em produção) | MEDIUM (205 occurrences) | P2 |
| Blockchain Observer persistência | HIGH (sem perda de eventos) | LOW (nova tabela DB) | P2 |
| TEAL escrow on-chain | MEDIUM (escrow real vs simulado) | HIGH (smart contract + auditoria) | P3 |
| Metered billing / self-service onboarding | HIGH (escala do negócio) | HIGH | P3 |
| EU Digital Product Passport compliance | MEDIUM (mercado europeu) | HIGH | P3 |

**Priority key:**
- P1: Necessário para produção confiável
- P2: Necessário para escala
- P3: Diferenciador de longo prazo

---

## Competitor Feature Analysis

| Feature | Everledger | Arianee | Authena | Quantum Cert (este projeto) |
|---------|------------|---------|---------|----------------------------|
| Registro de ativo | Sim — item-level identity | Sim — Digital Product Passport tokenizado | Sim — NFC + blockchain | Sim — metadata opaco |
| Ancoragem blockchain | Sim — private blockchain | Sim — multi-chain EVM | Sim — IoT + blockchain | Sim — Algorand + multi-chain plugável |
| NFC anti-replay | Via parceiros (IoT sensors) | Via NFC labels | Sim — AES-128 SDM CMAC | Sim — CMAC rolling, anti-replay por contador |
| Assinatura pós-quântica | Não | Não | Não | Sim — Falcon-512 embarcado (diferenciador único) |
| Verificação pública | Sim — via API | Sim — via protocolo | Sim — consumer app | Sim — endpoint público sem auth |
| Transferência de propriedade | Sim — via email/phone | Sim — via protocolo | Sim | Sim — TransferRegistryFacet |
| Escrow time-lock | Não identificado | Não identificado | Não identificado | Sim — EscrowFacet (parcial) |
| Agentes IoT/M2M com assinatura | Via parceiros | Não identificado | Sim (IoT devices) | Sim — AgentRegistryFacet + Falcon-512 |
| Multi-tenant white-label | Sim | Sim | Sim | Sim — Diamond Pattern, domain-agnostic |
| Audit trail imutável | Sim | Sim | Sim | Sim — EventLog append-only |
| Webhook API | Sim | Sim | Sim | Sim |
| Curation layer | Não identificado | Não identificado | Não identificado | Sim — único feature de curation com fila de aprovação |

**Diferenciadores únicos identificados:**
1. Falcon-512 embedded on-chain — nenhum competidor direto identificado com PQC nativo
2. Curation layer com aprovação de auditor — modelo de "confiança escalada" para certificadoras
3. Diamond Pattern domain-agnostic — white-label verdadeiro sem hardcoded de domínio (luxo, pharma, etc.)
4. Agent registry com Falcon-512 payload signing — IoT M2M com PQC, não apenas HMAC

---

## Sources

- Everledger platform features: https://everledger.io/our-platform/ | https://everledger.io/blockchain-asset-tracking/
- Arianee protocol: https://www.arianee.org/ | https://www.arianee.com/post/inside-the-most-used-protocol-for-real-world-product-tokenization
- Authena anti-counterfeiting platform: https://authena.io/anti-counterfeit-software/
- Digital Product Passport features: https://www.abiresearch.com/blog/top-digital-product-passport-dpp-software-providers | https://psqr.eu/digital-product-passport/
- Post-quantum cryptography as differentiator: https://www.safelogic.com/blog/post-quantum-cryptography-pqc-competitive-advantage-for-tech-vendors | https://hedera.com/blog/post-quantum-cryptography-and-blockchain/
- iTRACE blockchain + AI anti-counterfeiting: https://itracetech.com/2024/05/13/revolutionary-ai-and-blockchain-integration-enhances-anti-counterfeiting-measures-for-global-brands/
- IoT + blockchain traceability: https://blocsys.com/blockchain-supply-chain-traceability-system/
- NFC + blockchain asset authentication: https://qliktag.com/real-world-asset-tokenization-nfc-authentication-a-game-changer-for-physical-asset-ownership/
- Blockchain escrow for product transfers: https://pixelplex.io/work/blockchain-supply-chain-and-anti-counterfeit-solution/
- Codebase direct analysis: `/Volumes/External SSD/Projects/qc-backend/.planning/codebase/ARCHITECTURE.md` e `CONCERNS.md` (HIGH confidence)

---

*Feature research for: Backend SaaS multi-tenant — certificação de ativos físicos e digitais via blockchain + PQC*
*Researched: 2026-05-08*
