# Phase 3: Pluggable DLT Workers — Stellar/Soroban Priority — Specification

**Created:** 2026-05-10
**Ambiguity score:** 0.12 (gate: ≤ 0.20)
**Requirements:** 5 locked + 1 nice-to-have
**Updated:** 2026-05-14 — REQ-6 reclassificado; escopo Stellar-first/Solana-ready e recorte de execução clarificados
**Deadline:** 2026-05-16 (hackathon Stellar/NearX)

## Goal

Um juiz externo do hackathon Stellar pode verificar a autenticidade de um asset criado na plataforma Quantum Cert acessando `/verify`, ver o `dltTxId` com link para o Stellar Expert (testnet), e confirmar a transação real no explorer.

## Background

O `SorobanAdapter.ts` (401 linhas) implementa `IDLTAdapter` com `anchorEvent()` e `verifyAnchor()`. O contrato Soroban (`contracts/soroban/payment/src/lib.rs`, 340 linhas) tem `anchor_event` e `get_anchor_hash` implementados. O `DLTAdapterFactory` já roteia `STELLAR → SorobanAdapter`. O `AnchorQueueService` já lê `tenant.targetChain` e usa o adapter correto.

O foco principal agora é fazer Stellar funcionar de ponta a ponta. Porém o ambiente já está preparado para multi-chain, então a implementação não deve transformar o core em Stellar-only. Quando Solana for testada depois, a troca deve exigir principalmente um novo adapter/provisionamento/mapeamento de explorer, não reimplementação de queue, verificação pública ou contrato de resposta. A chain escolhida para um evento deve ser atômica: resolvida por `tenant.targetChain`, processada por um único `IDLTAdapter`, persistida em `ChainTransaction.chain`, e refletida no payload público.

O que NÃO existe hoje:

1. O contrato nunca foi compilado/deployado — `STELLAR_ANCHOR_CONTRACT_ID` é placeholder no `.env.example`
2. Nenhum tenant tem `targetChain = STELLAR` — todos usam o default `ALGORAND`
3. O `publicVerify` no dashboard não expõe `dltTxId` no response
4. A página `VerifyAsset.tsx` não exibe prova blockchain genérica nem link de explorer
5. O script `provision-stellar.ts` (citado na spec de hackathon) não existe
6. x402/micropagamento ainda é decisão de produto em aberto. A rota `GET /api/v1/public/verify/document/{hash}` é o ponto de integração natural para monetização futura, mas não deve bloquear a entrega Stellar. A implementação deve ficar implícita/opt-in por env var, com default desligado, e a direção preferida é estudar integração via Anchor que opere par pareado ao Real Brasileiro, por exemplo BRZ via Transfero.

## Requirements

1. **Contrato deployado no testnet**: O contrato Soroban é compilado para WASM e deployado na testnet Stellar, gerando um `CONTRACT_ID` real.
   - Current: `STELLAR_ANCHOR_CONTRACT_ID` é placeholder (`C000...`); contrato nunca foi compilado ou deployado
   - Target: `STELLAR_ANCHOR_CONTRACT_ID` real no `.env`; contrato verificável em `https://stellar.expert/explorer/testnet/contract/{id}`
   - Acceptance: `curl https://soroban-testnet.stellar.org` com invocação de `get_anchor_hash` para um `event_id` existente retorna resposta válida (não erro de contrato inexistente)

2. **Script de provisionamento**: `src/scripts/provision-stellar.ts` cria ou lê keypair Stellar, faz fund via Friendbot, e imprime env vars prontas para copiar.
   - Current: Script não existe; provisionamento é manual
   - Target: `npx tsx src/scripts/provision-stellar.ts` imprime `STELLAR_AUTHORITY_SECRET_KEY`, `STELLAR_ANCHOR_CONTRACT_ID` e `STELLAR_HORIZON_URL` no stdout
   - Acceptance: Executar o script em ambiente limpo (sem env vars Stellar) gera keypair fundado pelo Friendbot e imprime as 3 variáveis sem erro

3. **Tenant de demo com targetChain STELLAR**: Existe um tenant (seed ou migration) com `targetChain = 'STELLAR'` no banco de dados de desenvolvimento.
   - Current: Todos os tenants têm `targetChain = 'ALGORAND'` (default do schema Prisma)
   - Target: Seed ou script cria tenant de demo com `targetChain = 'STELLAR'`; `AnchorQueueService` processa seus `EventLog` records via `SorobanAdapter`
   - Acceptance: Criar um asset via API usando a API key do tenant STELLAR e aguardar o `AnchorQueueService` resulta em um `EventLog` com `dltTxId` não-nulo e `chain = 'STELLAR'` na tabela `ChainTransaction`

4. **publicVerify expõe prova blockchain genérica**: O endpoint `publicVerify` no dashboard retorna `dltTxId`, `chain`, `anchoredAt` e, quando disponível, `explorerUrl` para qualquer chain ancorada.
   - Current: O response de `publicVerify` não inclui campos de blockchain — retorna apenas `name`, `description`, `status`, etc.
   - Target: Response inclui `{ blockchain: { dltTxId: string, explorerUrl: string | null, chain: string, anchoredAt: Date } | null }` — `null` quando asset não ancorado
   - Acceptance: Chamar `publicVerify` para um asset ancorado retorna `blockchain.chain`, `blockchain.dltTxId` e `blockchain.anchoredAt`; para Stellar, retorna também `blockchain.explorerUrl` no formato `https://stellar.expert/explorer/testnet/tx/{dltTxId}`

5. **Card blockchain genérico na VerifyAsset.tsx**: A página `/verify` exibe uma prova blockchain para qualquer chain quando `blockchain` está presente no response.
   - Current: `VerifyAsset.tsx` não tem nenhum componente ou lógica para exibir informações blockchain
   - Target: Card "Verificação Blockchain" aparece abaixo das informações do asset para qualquer `blockchain.chain`, mostrando chain, `dltTxId` truncado, data de ancoragem, e link de explorer quando `blockchain.explorerUrl` existir
   - Acceptance: Acessar `/verify?assetId={id}` para qualquer asset com `blockchain` renderiza o card. Para o asset Stellar do UAT, o link aponta para `https://stellar.expert/explorer/testnet/tx/{dltTxId}`; para assets não ancorados o card não aparece

6. **[NICE TO HAVE] Hook opcional de micropagamento/x402 no endpoint de verificação pública**: O endpoint `GET /api/v1/public/verify/document/{hash}` pode ser preparado para cobrança futura, mas deve continuar gratuito por default.
   - Current: Endpoint é totalmente gratuito (sem auth, sem pagamento)
   - Target: Configuração env-driven, por exemplo `X402_ENABLED=false` por default. Quando desligado, a rota mantém o comportamento gratuito. Quando ligado em ambiente experimental, o middleware de pagamento pode ser ativado sem alterar contrato da rota. A estratégia de liquidação ainda será definida, com preferência por Anchor que opere BRZ/Real Brasileiro (ex: Transfero) em vez de assumir USDC como decisão final.
   - Acceptance: Com `X402_ENABLED=false` ou env ausente, `GET /api/v1/public/verify/document/{hash}` retorna o contrato normal de verificação, sem exigir pagamento. Testes e docs deixam claro que cobrança é opt-in/nice-to-have, não requisito bloqueante da fase.

## Boundaries

**In scope:**

- Deploy do contrato Soroban existente no testnet Stellar
- Preservação das abstrações multi-chain existentes (`tenant.targetChain`, `DLTAdapterFactory`, `IDLTAdapter`, `ChainTransaction.chain`) para que Solana entre depois sem reescrever queue/verificação
- Script `provision-stellar.ts` para setup do keypair + Friendbot
- Tenant de demo com `targetChain = STELLAR` (seed/script)
- Campo `blockchain` no response de `publicVerify` (backend + tRPC)
- Card "Verificação Blockchain" genérico na `VerifyAsset.tsx`; link Stellar Expert é apenas o caso concreto do UAT Stellar
- Hook opcional de pagamento/x402 no `GET /api/v1/public/verify/document/:hash`, desligado por default via env var; estratégia futura preferida: Anchor/BRZ (ex: Transfero)

**Out of scope:**

- Solana adapter (DLT-02) — hackathon é Stellar; Solana é próximo hackathon. Esta fase não implementa Solana, mas também não deve criar acoplamento que force reimplementação quando Solana entrar.
- `lastScannedBlock` persistido em DB (DLT-05) — resiliência a restart é requisito de produção, não de testnet
- Omnibus routing multi-chain completo (DLT-04) — um tenant STELLAR basta para o demo; esta fase apenas preserva os seams para adapters futuros
- Mainnet deploy — testnet é suficiente para o hackathon
- Auditoria de segurança do contrato Soroban — escopo de produção (Phase 4+)
- Ethereum, Polygon adapters — não são prioridade desta phase

## Constraints

- Deadline hard: 2026-05-16 23:59 — tudo deve estar commitado e demo rodando
- Testnet apenas: `STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET`, `STELLAR_HORIZON_URL = https://horizon-testnet.stellar.org`
- O contrato já existente (`contracts/soroban/payment/src/lib.rs`) deve ser usado sem refactoring — mudanças no contrato abrem risco de regressão
- Golden Rule: nenhum termo de domínio no core — campos do response usam `asset`, `event`, `anchor`, nunca termos de negócio
- O `SorobanAdapter` já existe e não deve ser reescrito — apenas configurado com env vars reais
- Código de core e UI pública deve permanecer chain-agnostic. Regras específicas de Stellar ficam em `SorobanAdapter`, `provision-stellar` e helper de explorer URL; `AnchorQueueService`, `DocumentVerificationFacet`, contratos públicos e dashboard devem operar pelo valor persistido de `chain`.
- 3 commits no GitHub são requisito do hackathon (REQ-HK-01) — os 6 requirements acima devem resultar em pelo menos 3 commits semânticos distintos
- Micropagamentos/x402 não são must-have desta fase. Não assumir USDC, pacote específico ou provedor final sem nova decisão. Qualquer implementação deve ser opt-in por env e segura quando desligada.

## Acceptance Criteria

- [ ] `STELLAR_ANCHOR_CONTRACT_ID` real no `.env` — verificável em `stellar.expert/explorer/testnet/contract/{id}`
- [ ] `npx tsx src/scripts/provision-stellar.ts` executa sem erro e imprime 3 env vars
- [ ] Asset criado com API key do tenant STELLAR resulta em `EventLog.dltTxId` não-nulo após o `AnchorQueueService` processar
- [ ] `AnchorQueueService` continua roteando por `tenant.targetChain`/`DLTAdapterFactory`, sem branches Stellar-only que impeçam um adapter Solana futuro
- [ ] `publicVerify` retorna `blockchain.explorerUrl` para assets ancorados no Stellar
- [ ] `/verify?assetId={id}` renderiza card "Verificação Blockchain" para qualquer `blockchain.chain`; no UAT Stellar, o card inclui link clicável para `stellar.expert`
- [ ] Com `X402_ENABLED=false` ou env ausente, `GET /api/v1/public/verify/document/{hash}` continua gratuito e retorna a prova blockchain normal
- [ ] [NICE TO HAVE] Se `X402_ENABLED=true` em ambiente experimental, o middleware de pagamento é ativado de forma explícita e documentada, sem afetar `/api/v1/scan`
- [ ] Pelo menos 3 commits de código no GitHub (não apenas docs)

## Ambiguity Report

| Dimension           | Score | Min   | Status | Notes                                                |
| ------------------- | ----- | ----- | ------ | ---------------------------------------------------- |
| Goal Clarity        | 0.92  | 0.75  | ✓      | Fluxo E2E e público-alvo (juiz hackathon) definidos  |
| Boundary Clarity    | 0.90  | 0.70  | ✓      | Solana implementation fora, seams multi-chain dentro |
| Constraint Clarity  | 0.80  | 0.65  | ✓      | Deadline 16/mai, testnet, contrato existente         |
| Acceptance Criteria | 0.88  | 0.70  | ✓      | 6 checks must-have + 1 check nice-to-have objetivo   |
| **Ambiguity**       | 0.12  | ≤0.20 | ✓      |                                                      |

## Interview Log

| Round | Perspectiva      | Pergunta resumida                | Decisão travada                                                                                           |
| ----- | ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1     | Researcher       | Qual gap real trava o demo?      | Ambos: contrato não deployado + tenant targetChain=ALGORAND                                               |
| 1     | Researcher       | Hackathon ou produção?           | Hackathon primeiro — demo funcional no testnet                                                            |
| 2     | Simplifier       | Fluxo mínimo do Loom?            | Criar asset → AnchorQueue → /verify com txId + link explorer                                              |
| 2     | Simplifier       | O que fica fora?                 | Solana adapter (DLT-02) fora; outros itens mantidos                                                       |
| 3     | Boundary Keeper  | DLT-04/05 dentro ou fora?        | Ambos fora — só o necessário para hackathon                                                               |
| 3     | Boundary Keeper  | Definição de "pronto"?           | 3 checks: tx Stellar Expert + dltTxId na API + badge na UI                                                |
| —     | Revisão pós-spec | x402/micropagamento é must-have? | Não. REQ-6 virou nice-to-have, controlado por env var e com estudo futuro para Anchor/BRZ (ex: Transfero) |
| —     | Revisão pós-plan | Dashboard proof é Stellar-only?  | Não. Card "Verificação Blockchain" renderiza qualquer `blockchain.chain`; Stellar é apenas o UAT atual    |

---

_Phase: 03-pluggable-dlt-workers-stellar-soroban-priority_
_Spec created: 2026-05-10_
_Next step: $gsd-execute-phase 3_
