# Documentação da API Pública (V3)
**Quantum Cert Engine (Enterprise API Reference)**

Padrão arquitetural *Omnibus* (Centralização Master Wallet). Este documento técnico serve de fundação para integração Sênior de nossos B2B parceiros, atestando confiabilidade assíncrona, Fail-Fast e Idempotência absoluta.

---

## 1. Ambientes de Integração (Environments)

As URLs expostas pelo nosso API Gateway convergem estritamente nestes dois *stages*:

- **Sandbox (Testnet):** `https://sandbox-api.quantumcert.io/api/v1`
- **Production (Mainnet):** `https://api.quantumcert.io/api/v1`

## 2. Autenticação, Idempotência & Rate Limits

Todas as requisições devem incluir a chave provisionada *Pre-Shared Key* na infraestrutura KMS do seu lojista.

**Headers Requeridos:**
```http
x-api-key: qc_sua_chave_secreta_aqui
Idempotency-Key: 123e4567-e89b-12d3-a456-426614174000  [Obrigatório em POST/PATCH]
```

**Idempotência Obrigatória:**
No desenvolvimento de sistemas tolerantes a falhas (ex: quebras de túneis TLS intermediárias ou *timeouts* de *Retry* da sua ponta), nosso motor exige a assinatura UUIDv4 no `Idempotency-Key`. Caso nosso sistema receba o mesmo UUID acoplado à mesma carga em um intervalo restrito, abortamos o fluxo original e devolvemos instantaneamente a transação primária cachedada (status 200/201 original), impedindo "Eventos em Duplicidade" ou "Gastos Duplos" na Blockchain.

**Rate Limiting:**
Nossos escudos inferem limites rígidos acoplados ao `tenantId`. Acompanhe nos cabeçalhos de Response:
- `X-RateLimit-Limit`: Capacidade do plano contrato na janela.
- `X-RateLimit-Remaining`: Fração disponível.

---

## 3. Webhooks & Integridade Criptográfica (Security Callbacks)

Transações vitais (*DLT Anchoring*) rodam assincronamente. Implemente nossos webhooks para ser notificado imediatamente após a maturação transacional. O Payload entregue pela Quantum Cert tem validação criptográfica absoluta.

**Header de Autenticidade (Obrigatório Validação pelo Parceiro):**
```http
x-qc-signature: ec7a5db... [HMAC SHA-256 (Payload JSON Bruto + WEBHOOK_SECRET)]
```

**Exemplos de JSON Payload Recebido (Webhook Data):**

*Tento de Sucesso (Consenso Algorand Atingido):*
```json
{
  "event": "ANCHOR_SUCCESS",
  "timestamp": "2026-12-14T10:00Z",
  "data": {
    "eventId": "evt_abc123",
    "assetId": "ast_99291",
    "dltTxId": "YXT39281H2O9AS...",
    "status": "APPROVED",
    "signatureHash": "a1b2c3d4..."
  }
}
```

*Tento de Falha Crítica (Dead Letter Queue):*
```json
{
  "event": "ANCHOR_FAILED",
  "timestamp": "2026-12-14T10:01Z",
  "data": {
    "eventId": "evt_abc123",
    "assetId": "ast_99291",
    "dltTxId": "FAILED_TIMEOUT",
    "status": "DLQ",
    "errorReason": "RPC Algorand Unreachable / Timeout Excessivo"
  }
}
```

---

## 4. Endpoints RESTful Principais (Mapeamento Diamond Proxy Espelhado)

### a. Criar um Ativo Físico ou Lógico (Fabricação)
`POST /api/v1/assets`

**Request:**
```json
{
  "externalId": "CHASSI-XZ81920",
  "metadata": { "fabricante": "Porsche" },
  "owners": [{ "ownerRef": "CPF_OU_CNPJ_DESTINO", "sharePercent": 100 }]
}
```

### b. Consultar a História Fiel do Ativo (Com Paginação Cursorial)
`GET /api/v1/assets/:assetId`

Retorna a ontologia de um Ativo e o Array integral de eventos vitais.

**Query Parameters Exigidos para Paginação:**
- `?limit=50`: (Max 100) Restringe janela de retorno.
- `?cursor=last_event_id`: ou alternativamente paginação offset `?page=1`.
- `?sort=desc`: Ordem transacional do tempo físico.

**Response (200 OK):**
```json
{
   "success": true,
   "data": {
      "id": "ast_99291...",
      "externalId": "CHASSI-XZ81920",
      "events": [
         {
            "id": "evt_abc123", "tipo": "TRANSFERENCIA", "dltTxId": "YXT39281...", "status": "APPROVED"
         }
      ],
      "pagination": {
          "nextCursor": "evt_xyz456",
          "hasMore": true
      }
   }
}
```

### c. Registrar Integridade Hardware de NTAG 424 DNA (NFC)
`POST /api/v1/devices`

Requisita obrigatoriamente status Administrativo. Injeta o Identificador (UID) limitando o `initialCounter` (Anticlonagem de Replay) na nuvem.

**Request:**
```json
{
  "uid": "04A1B2C3D4E5AB",
  "initialCounter": 0
}
```

---

## 5. Falhas Expressas Transacionais (HTTP Fail-Fast)

| HTTP Code | Significação e Intervenção de Restauração |
|---|---|
| `400 Bad Request` | Faltam parâmetros ou *Idempotency-Key* ausente. (Falha de Schema Estrito). |
| `401 Unauthorized` | Chave de Api ausente/falsa. |
| `403 Forbidden` | Bloqueio RBAC. Uso isolado. (Dica: utilize *Bypass* Forense caso emane de Perícia Oficial, *role* `EXPERT`). |
| `409 Conflict` | UUID da Idempotência colidindo com requisições *in-flight* concorrentes. Aborte e recheque. |
| `429 Too Many Requests` | Limites temporais rompidos. Recalcule o Backoff da sua fila de envios baseando-se no Header X-RateLimit. |
| `500 Server Error` | Exaustão crítica das Máquinas/Ledgers Centrais Master ou Falha na Geração do KeyPair Falcon-512 WASM. |
