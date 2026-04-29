# Sub-sistema QTAG — Design Spec
**Data:** 2026-04-28  
**Status:** Aprovado  
**Escopo:** CommissioningService + SDM Verifier (Sub-sistema QTAG completo)

---

## 1. Visão Geral

O Sub-sistema QTAG cobre o ciclo de vida físico de uma QTAG (NTAG 424 DNA):

1. **Commissioning** — operador grava criptografia + blockchain na tag NFC (fábrica ou campo)
2. **Verification (SDM)** — smartphone de consumidor/auditor toca a tag → backend valida autenticidade em 4 camadas

Ambos os fluxos são distintos em ator, rota e nível de autenticação, mas compartilham a mesma camada de crypto (`QTagCryptoService`).

---

## 2. Arquitetura

### 2.1 Componentes

| Componente | Tipo | Responsabilidade |
|---|---|---|
| `CommissioningFacet` | DiamondProxy Facet (ADMIN/OPERATOR) | Orquestra etapas 1–6 do commissioning; retorna layout 144 bytes para cliente gravar |
| `SDMVerifierService` | Serviço standalone | Valida taps de smartphone (CMAC, monotonicidade, Haversine) |
| `QTagCryptoService` | Serviço shared | CMAC-AES, HKDF/DAT, Haversine, layout NTAG 144 bytes |
| Cliente externo | Estação de encoding (não-backend) | Executa APDUs 7–9 via ACR122U; chama `commissioning.confirm` ao concluir |

### 2.2 Rotas

```
POST /api/v1/diamond
  selector: commissioning.start    → inicia sessão de comissionamento
  selector: commissioning.confirm  → confirma gravação física concluída
  selector: commissioning.status   → consulta status da sessão

GET  /api/v1/scan
  ?p=<picc_data>&m=<cmac>&lat=<lat>&lon=<lon>
  → pública, sem apiKeyAuth, com IP rate limit
```

### 2.3 Diagrama de dependências

```
CommissioningFacet
  ├── QTagCryptoService   (CMAC, DAT, layout)
  ├── QuantumSignerService (Falcon-512, já existente)
  ├── KMSService           (SDM keys, já existente)
  └── AnchorQueueService   (Algorand anchor, já existente)

SDMVerifierService
  ├── QTagCryptoService   (CMAC, Haversine, decifrar picc_data)
  └── KMSService           (recupera sdmEncKey, sdmMacKey)
```

---

## 3. Fluxo de Commissioning

### 3.1 Etapas do backend (1–6)

O backend executa todas as etapas criptográficas e de blockchain. O cliente externo executa apenas as etapas de hardware NFC.

**Etapa 1 — Falcon-512 keypair**
- `QuantumSignerService.generateKeyPair()` → `{ publicKey (897 bytes), privateKey (1281 bytes), publicKeyHash }`
- Private key: **nunca persiste** no banco. Referenciado via HSM/KMS em produção.
- Public key hash persiste em `FalconKey` (tabela existente ou nova, conforme KMS).

**Etapa 2 — Assinar metadata (Falcon Hash)**
- Input: `{ assetId, entityType, metadata, timestamp }`
- Output: `falconHash` (SHA3-512 da assinatura Falcon-512, 64 bytes)
- `truncatedFalconHash` (32 bytes, para note field Algorand)

**Etapa 3 — Derivar DAT via HKDF-SHA3-256**
- `IKM = falconHash (64 bytes) + ntagUID (7 bytes)`
- `Salt = ntagUID (7 bytes)`
- `Info = "QTAG-DAT-v1"`
- Output: 32 bytes → truncar para 16 bytes (`truncatedDAT`)

**Etapa 4 — Ancorar no Algorand**
- Note field: `QC| + tenantSHA256 + falconHash truncado + DAT hash`
- Via `AnchorQueueService` (FIFO existente) ou transação direta para commissioning
- Output: `anchorTxId`, `blockHeight`

**Etapa 5 — Gerar SDM keys**
- `sdmMacKey` (AES-128, 16 bytes) → valida CMAC no tap
- `sdmEncKey` (AES-128, 16 bytes) → cifra UID+CTR no URL da tag
- Ambas geradas via `KMSService`, armazenadas cifradas, referenciadas por ID
- **Nunca persistir plaintext**

**Etapa 6 — Montar layout NTAG 144 bytes**

| Offset | Bytes | Conteúdo |
|---|---|---|
| 0–1 | 2 | Versão protocolo `0x0100` |
| 2–9 | 8 | UID truncado |
| 10–25 | 16 | DAT truncado |
| 26–57 | 32 | Falcon Hash truncado |
| 58–61 | 4 | ARC-89 pointer (opcional) |
| 62–95 | 34 | Metadata checksum (SHA3-256 + CRC16) |
| 96–143 | 48 | Reservado `0x00` |

Output: `layoutB64` (144 bytes em base64), dividido em 36 páginas de 4 bytes cada.

**Response para cliente externo:**
```json
{
  "sessionId": "clx...",
  "layout": "<base64 144 bytes>",
  "pages": ["<base64 4 bytes>", ...],
  "sdmMacKey": "<plaintext AES-128 hex — exposto UMA vez, nunca persiste>",
  "writeKey": "<AES-128 para autenticação APDU>",
  "lockAfterWrite": false
}
```

### 3.2 Etapas do cliente externo (7–9)

O cliente externo (estação desktop/CLI) é responsável por:
- **Etapa 7** — verificar ACR122U conectado e NTAG presente
- **Etapa 8** — autenticar com `writeKey` e escrever 36 páginas via APDU
- **Etapa 9** — lock configuration (se `lockAfterWrite: true`)

Ao concluir, chama `commissioning.confirm`:
```json
{
  "sessionId": "clx...",
  "success": true,
  "bytesWritten": 144,
  "ntagUID": "04AABBCCDDEE"
}
```

### 3.3 Confirm (backend persiste)

O backend valida o `sessionId`, persiste o `Device` linkado ao `Asset`, atualiza `EncodingSession.status = COMPLETED`, e armazena `sdmMacKeyId` + `sdmEncKeyId` no `Device`.

---

## 4. Fluxo SDM Verifier (Tap do Smartphone)

### 4.1 URL gerada pela tag

O NTAG 424 DNA opera em modo SDM cifrado. A URL gerada automaticamente pelo chip tem formato:

```
GET /api/v1/scan?p=<picc_data>&m=<cmac>&lat=<lat>&lon=<lon>
```

- `picc_data` — AES-128 cifrado contendo `UID (7 bytes) + CTR (3 bytes)`. Nunca expõe UID em plaintext.
- `m` — CMAC truncado (índices ímpares do full CMAC, 8 bytes = 16 hex chars)
- `lat`, `lon` — injetados pelo browser/app do smartphone (opcional, usado para Haversine)

### 4.2 Validação em 4 camadas

**Camada Zero — Sanitização estrita (antes de qualquer crypto):**
```
picc_data: /^[0-9A-Fa-f]{32}$/   (16 bytes cifrados)
cmac:      /^[0-9A-Fa-f]{16}$/   (8 bytes truncados)
```
Falha → `400 Bad Request` imediato.

**Camada 1 — Decifrar picc_data**
- Recupera `sdmEncKey` do KMS via `Device.sdmEncKeyId`
- Decifra `picc_data` com AES-128 → extrai `uid` + `ctr`
- Busca `Device` por `uid` no banco
- Falha → `{ status: "DENIED", reason: "DEVICE_NOT_FOUND" }`

**Camada 2 — Validar CMAC**
- `mac_input = uid_bytes + ctr_bytes_LSB`
- `full_mac = CMAC-AES(mac_input, sdmMacKey)`
- `mac_expected = full_mac[1::2]` (truncamento índices ímpares)
- Falha → `{ status: "DENIED", reason: "MAC_INVALID" }`

**Camada 3 — Monotonicidade do contador**
- `ctr > Device.lastCounter` (estritamente maior)
- Falha → `{ status: "DENIED", reason: "REPLAY_ATTACK" }`

**Camada 4 — Telemetria geoespacial (Haversine)**
- Calcula distância entre `(lat, lon)` atual e `Device.lastLat/lastLon`
- Calcula velocidade: `distância_km / tempo_horas`
- Limite: 1000 km/h
- Primeira leitura (`lastLat == 0 && lastLon == 0`) → bypass
- Falha → `{ status: "DENIED", reason: "RELAY_ATTACK" }`

**Update atômico (Prisma transaction):**
```typescript
await prisma.$transaction([
  prisma.device.update({ lastCounter: ctr, lastTapAt, lastLat, lastLon, totalTaps++ }),
  prisma.deviceTapLog.create({ deviceId, counter: ctr, lat, lon, ip, result: "APPROVED" })
]);
```

### 4.3 Response aprovado

```json
{
  "status": "APPROVED",
  "counter": 42,
  "asset": {
    "id": "clx...",
    "publicUrl": "https://qc.io/a/abc123",
    "metadata": { "...apenas publicDataKeys..." },
    "anchorTxId": "ALGO_TX_ABC...",
    "blockHeight": 12345678,
    "status": "ACTIVE"
  }
}
```

**Regra de privacidade:** `metadata` no response expõe **apenas** as chaves presentes em `Asset.publicDataKeys`. O restante fica opaco.

### 4.4 Responses negados

```json
{ "status": "DENIED", "reason": "MAC_INVALID",       "message": "Assinatura inválida." }
{ "status": "DENIED", "reason": "REPLAY_ATTACK",     "message": "Link clonado ou expirado." }
{ "status": "DENIED", "reason": "RELAY_ATTACK",      "message": "Anomalia de geolocalização." }
{ "status": "DENIED", "reason": "DEVICE_NOT_FOUND",  "message": "Tag não registrada." }
{ "status": "DENIED", "reason": "DEVICE_INACTIVE",   "message": "Tag desativada." }
```

---

## 5. Modelo de Dados

### 5.1 Nova tabela: `EncodingSession`

```prisma
model EncodingSession {
  id          String         @id @default(cuid())
  tenantId    String
  assetId     String         @unique
  ntagUID     String
  status      EncodingStatus @default(PENDING)
  layoutB64   String         // 144 bytes em base64
  sdmMacKeyId String         // referência KMS
  sdmEncKeyId String         // referência KMS
  anchorTxId  String?
  lockedAt    DateTime?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  @@index([tenantId])
  @@index([ntagUID])
  @@index([status])
}

enum EncodingStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
}
```

### 5.2 Extensão: `Device`

Adicionar dois campos ao modelo existente:

```prisma
sdmMacKeyId String?   // referência KMS para validação de tap
sdmEncKeyId String?   // referência KMS para decifrar picc_data
```

---

## 6. Segurança

| Controle | Implementação |
|---|---|
| UID nunca em plaintext na URL | SDM modo cifrado (picc_data AES-128) |
| Chaves SDM nunca no banco | Referências KMS; plaintext só em memória durante request |
| Private key Falcon nunca persiste | HSM/KMS; usada e descartada em memória |
| Sanitização de entrada | Regex antes de qualquer crypto; falha → 400 |
| Anti-replay | Contador monotônico estritamente crescente |
| Anti-relay | Haversine + velocidade < 1000 km/h |
| Rate limit público | 30 req/min por IP no `server.ts` para `/api/v1/scan` |
| Update atômico | Transação Prisma: update counter + log em uma operação |

---

## 7. Testes

| Tipo | Cobertura |
|---|---|
| Unit — `QTagCryptoService` | Vetores CMAC oficiais NXP, DAT derivation (RFC 5869), Haversine edge cases (polo, antípodas, primeira leitura) |
| Unit — `SDMVerifierService` | Cada camada de rejeição isolada com mocks do KMS e Prisma |
| Unit — `CommissioningFacet` | Cada etapa isolada; mock do `QuantumSignerService` e `KMSService` |
| Integration | Fluxo completo de commissioning com Prisma real e Algorand testnet |
| E2E (lab) | Tap com NTAG físico real (ACR122U + NTAG 424 DNA) |

---

## 8. Novas Dependências

| Pacote | Uso |
|---|---|
| `cmac` (npm) | CMAC-AES em TypeScript (ou implementação via `node:crypto` AES-CBC) |

Sem novas variáveis de ambiente obrigatórias. O KMS e Algorand já estão configurados.

---

## 9. Fora de Escopo

- Interface gráfica da estação de encoding (cliente externo é responsabilidade do integrador)
- ARC-89 Algorand NFT (etapa 4 do FLUXO_QTAG) — adiado para iteração futura
- Suporte a outros chips NFC além de NTAG 424 DNA
- Revogação de tag (desativação via `Device.isActive` já existe no schema)
