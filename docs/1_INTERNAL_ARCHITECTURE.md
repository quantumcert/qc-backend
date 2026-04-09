# Guia Definitivo de Arquitetura Interna - Quantum Cert
**Para Engenharia de Integração & Time Next.js**

Bem-vindo à arquitetura de missão crítica (Tier 1) da **Quantum Cert**. Nosso Backend desenha resiliência B2B, isolamento locatário e ancoragem cripto de Ledger Interplanetário imutável com encriptação Falcon-512.

---

## 1. Stack Tecnológico Base
- **Runtime:** Node.js 18 LTS (Alpine Docker Runtime)
- **Engine Relacional:** PostgreSQL / Prisma
- **Ledger/Blockchain:** Algorand Mainnet
- **Criptografia Quântica:** Falcon-512 (WASM Compilation Wrapper `falcon-crypto`)

---

## 2. Paradigma EIP-2535 (Diamond Proxy Controller)

Adotamos a lógica *Diamond* diluindo as responsabilidades gigantes de um microsserviço monolítico em **Facets** transparentes roteados internamente:
- **`AssetRegistryFacet`**: Criação de Ativos em Cloud. Relaciona Locatários à Órfãos Híbridos.
- **`EventLogFacet`**: Trilha Forense Irrefutável Mestra.
- **`AlgorandAnchorFacet`**: Conecta Node.js à infra Algorand empacotando os Uint8Array CIDs Pós-Quânticos.

---

## 3. A Mecânica Omnibus (Custódia Zero-Fricção e Abstenção de Gas)

Empresas tradicionais não treinarão seus clientes para decorar "Seed Phrases".
Modelamos o **Omnibus** como bala de prata:
1. O Master Ledger (Sponsor) paga categoricamente o Gas na rede (Sub-centavos via micropagamentos de valor *0 Algos* apenas para utilizar o recado do Blockchain 1000-bytes).
2. O Ownership corporativo real jaz exclusivamente no PostgreSQL em conformidade cega à restrições PII (LGPD).
3. A Algorand transforma-se de um livro contábil financeiro em um majestoso cartório notarial incartável.

---

## 4. KMS (Key Management System): Proteção de Material Falcon-512 

A regra magna do isolamento Quântico exige rigidez em Chaves Privadas brutais de 2.3k bytes.

1. **Master Ledger Wallet:** Blindada nativamente na infra Cloud encriptada sob `ALGORAND_MASTER_MNEMONIC`. Nunca exposta à loggers ou stdout. 
2. **Tenant Falcon-512 Keys:** O Prisma DB em Produção **JAMAIS ARMAZENA** as Privates Keys em formato legível de *Clear Text*. Utiliza-se a *inhalation environment* de `QUANTUM_CERT_SECRET` injetada, isolando a superfície de ataques SQL Injections devastadores. Configurações Sandbox em memória garantem a maleabilidade em testes. A regra é purista de *Zero-Knowledge Cloud*.

---

## 5. Resiliência Assíncrona e O Fluxo DLQ (Queue Mechanics)

Ancorar em L1s Distribuídas está fadada à entropia de queda de RPCs Nodes ou exaustão de MBRs e Timeouts Nativos. 

O `AnchorQueueService` é desenhado contra apocalipticas "Gas Drains":
- **Locks Atômicos Mutex:** Quando 5 workers instanciam, bloqueio rigoroso evita gastos dobrados da Master Wallet para um mesmo evento (Race Condition Fix).
- **Exponential Backoff:** Quando a DLT relata inconsistência ou `PENDING_FUNDS`, a transação entra de molho no backoff nativo retornando ciclicamente à fila em tempos logaritmicamente diluídos preventivos.
- **DLQ (Dead Letter Queue):** Falhas absolutas sem mitigação temporária (ex: RPC Unreachable perpétuo ou quebra da restrição de Byte de Notas de Algorand) não matam o Loop. O evento decai em um túmulo transacional (`dltTxId: "FAILED_TIMEOUT"` de status `"DLQ"`). 
  A partir da DLQ, alarmes Cloud alertam as malhas *DevSecOps* para Intervenção Manual, simultaneamente disparando o Payload `"ANCHOR_FAILED"` no Webhook do Tenancy correspondente.

A engenharia do Frontend (Next.js) assim deverá lidar gentilmente com cursores de Long Polling. Se transitar da fase *dltAnchorEnqueued: true* para aprovação real, pinta a tela com o *TxId* da Chain. Se transitar para o DLQ State, emite o respectivo painel de Falha Transitória.

---

## 6. RBAC Padrão Lógico & Quebras de Bypass

Arquitetura multi-locatário onde o locatário Z não acessa X. Exceção vital feita às *Roles* de alta alçada. Auditores Públicos, Seguradoras Independentes e Peritos Judiciais portadores de Credentials tipo `EXPERT` transitam em ativos terceirizados via **Bypass**. Registram manutenções e suas chaves cravam a assinatura judicial imaculada no log intocando o CPF civil primitivo, alinhando-se perfeitamente com Legislações Cibernéticas atuais.
