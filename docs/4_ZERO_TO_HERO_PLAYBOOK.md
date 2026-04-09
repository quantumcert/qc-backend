# O Playbook "Zero to Hero" - Guia de Integração Universal

Este manual compila a forma mais simples, robusta e direta de consumir a API da Quantum Cert. A plataforma foi desenhada como uma **Caixa Preta**: você não precisa entender a complexidade criptográfica ou descentralizada do motor. Seu único trabalho é enviar e receber dados limpos.

---

## Capítulo 1: O Modelo Abstrato (A Caixa Preta)

A API baseia-se em apenas três conceitos universais e fundamentais:

1. **Asset:** É a gaveta digital (entidade) do seu item. Ela possui identificadores e um campo `metadata` onde você guarda qualquer JSON que o seu negócio precisar.
2. **Device:** É o elo físico (a tag inteligente) que pode estar colado no seu item real.
3. **EventLog:** É o histórico imutável (a linha do tempo) da sua gaveta digital. Qualquer adição de informação ou mudança de estado é registrada aqui de forma permanente.

---

## Capítulo 2: A Regra de Segurança (Zero-Trust)

**Nunca exponha a sua `x-api-key` na interface do usuário (App, Web, Navegador).**

O fluxo de segurança obrigatório é o **Server-to-Server**: 
A sua Interface (App/Web do usuário final) se comunica exclusivamente com o Seu Servidor/Backend. É o Seu Servidor que detém a `x-api-key` e se comunica com a API da Quantum Cert. 

---

## Capítulo 3: O Passo-a-Passo de Uso

A integração diária envolve quatro ações principais:

### A. Criar o Ativo (Mintagem)
Você cria a gaveta digital no sistema.
- **Requisição:** `POST /api/v1/assets`
- **Regra:** Exige obrigatoriamente o envio do Header `Idempotency-Key` com um UUID único gerado pelo seu servidor para evitar criação duplicada.

### B. Ler a Tag Segura (Acoplamento Físico)
O dispositivo móvel do usuário lê a tag inteligente e abre uma URL do seu sistema contendo parâmetros de segurança.
1. A interface móvel extrai os parâmetros da URL: `uid`, `ctr` e `cmac`.
2. A interface envia isso para o Seu Servidor.
3. O Seu Servidor envia para nós: `GET /api/v1/devices/tap?uid={uid}&ctr={ctr}&cmac={cmac}`.
4. Nossa API avalia os dados e responde se o item físico é válido ou clonado, retornando junto as informações públicas da gaveta correspondente.

### C. Atualizar o Histórico (Injetar Evento)
Você adiciona um fato novo à linha do tempo da gaveta digital.
- **Requisição:** `POST /api/v1/assets/:id/events`
- **Regra:** Você envia um JSON livre detalhando o fato gerador. Exige obrigatoriamente o Header `Idempotency-Key` com um UUID único.

### D. Ouvir a Confirmação Final (Sincronização Assíncrona)
O assentamento dos dados na base criptográfica distribuída leva alguns segundos. 
- Você receberá um retorno imediato de sucesso no *POST* do evento, mas deve configurar uma rota no Seu Servidor (Webhook) para escutar ativamente as atualizações.
- Quando o processo terminar globalmente, nossa plataforma enviará uma requisição para a sua rota de Webhook com a confirmação (`ANCHOR_SUCCESS`) aprovando definitivamente a transação e devolvendo a identificação da transação (`dltTxId`).

---

## Capítulo 4: Master Context (Prompt para IAs)

Copie o bloco de código abaixo e cole no seu modelo de IA (Chat, IDE, Gerador de Código) para que ele construa as chamadas HTTP e a arquitetura do Seu Servidor automaticamente.

```text
[SYSTEM PROMPT START: QUANTUM_CERT_ENGINE_INTEGRATION]
You are a Senior Integrations Developer. Your task is to build a Server-to-Server integration with the Quantum Cert API.
You must strictly follow these rules:

=== SECURITY CONSTRAINTS ===
1. The API Key (`x-api-key`) MUST NEVER be exposed to the client interface. The client interface talks to our backend, and our backend talks to the API.
2. IDEMPOTENCY: Every mutable POST/PATCH request strictly REQUIRES the header `Idempotency-Key` with a unique generated `UUIDv4`.
3. WEBHOOK ASYNC PARADIGM: DLT commitments are asynchronous. A proper backend must expose a POST /webhook route protected by HMAC SHA-256 (validating the `x-qc-signature` header against our secret key) to listen for the specific payload `"event": "ANCHOR_SUCCESS"`.

=== CORE API ENDPOINTS MAP (Base URL: https://api.quantumcert.io/api/v1) ===

# CREATE ASSET
POST /assets
Headers: `x-api-key: <string>`, `Idempotency-Key: <uuidv4>`
Body Schema:
{
  "externalId": "<string_your_reference>", 
  "metadata": { /* ANY free-form JSON */ },
  "owners": [{ "ownerRef": "<string_identifier>" }]
}
Returns: Asset object with "id".

# GET ASSET OVERVIEW
GET /assets/{assetId}?limit=20&page=1
Headers: `x-api-key: <string>`
Returns: Asset details and a paginated array of "events" (with pagination parameters "nextCursor" / "hasMore").

# TAG VALIDATION
GET /devices/tap?uid=<UID>&ctr=<CTR>&cmac=<CMAC>
Headers: `x-api-key: <string>`
Mechanics: Forward physical parameters dynamically. Returns {"success": true, "verdict": "VALID", "publicData": {...}} OR {"success": false, "verdict": "REPLAY_BLOCKED|CMAC_INVALID"}

# ADD HISTORY EVENT
POST /assets/{assetId}/events
Headers: `x-api-key: <string>`, `Idempotency-Key: <uuidv4>`
Body Schema:
{ 
  "payload": { /* Details of the event */ } 
}

=== MISSION ===
Acknowledge this contract. Wait for specific implementation logic, and do not use any blockchain or crypto jargons for the UI. Build the proxy backend applying the API Key and Idempotency patterns.
[SYSTEM PROMPT END]
```
