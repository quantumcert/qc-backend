# Stellar Testnet — Primeira Transação

Gerado em 2026-05-09 como entrega do Desafio 1.2 do bootcamp Stellar 37° (NearX).

## Conta (Sender)

| Campo | Valor |
|---|---|
| Chave pública | `GCEHYZWGJRDPJME2BD5SBKAAACOLNNOV6H7GNTXYK74G2Z47NXLL2VSH` |
| Chave secreta | `SDJ2YE3R6GP4KBMV7BXJ57WF5NZNBPBZTPMCNAFWQ565AMIUQCPOP4BP` |

> **Atenção:** chave secreta exposta apenas por ser conta de testnet descartável. Nunca exponha secret keys de contas reais.

## Transação

| Campo | Valor |
|---|---|
| Hash | `ebfeedb3df16437bdc01b46615754206bfff78914daf28c98e06713eb8d22028` |
| Ledger | `2472975` |
| Rede | Testnet |
| Operação | Payment — 10 XLM |
| Destino | `GBAFUHHLRPGSRCLQLZAOUBR7POCZN2W5GYE26DBRZV5WROMXGMLYDEI3` |

## Verificação

```
https://stellar.expert/explorer/testnet/tx/ebfeedb3df16437bdc01b46615754206bfff78914daf28c98e06713eb8d22028
```

## Script usado

```js
// /tmp/stellar-lab.mjs — Node.js com stellar-sdk
// 1. Keypair.random() → sender + receiver
// 2. Friendbot financia ambas as contas com 10.000 XLM de teste
// 3. TransactionBuilder → Operation.payment (10 XLM) → assina → submitTransaction
// 4. Imprime hash confirmado pelo Horizon testnet
```
