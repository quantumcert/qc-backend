# 🔐 Quantum Cert - Documentação Técnica Completa
## Fluxo de Criação e Gravação QTAG v1.0

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Fluxo Completo (9 Etapas)](#fluxo-completo)
3. [Componentes Técnicos](#componentes-técnicos)
4. [Setup e Instalação](#setup-e-instalação)
5. [API Reference](#api-reference)
6. [Troubleshooting](#troubleshooting)

---

## 1. Visão Geral

### Arquitetura Quantum-Ready

```
Produto/Pet → Falcon-512 → DAT (HKDF) → Algorand → NTAG 424 DNA
    ↓            ↓             ↓           ↓            ↓
 Metadata    Hash Raiz     Derivação   ARC-89      Gravação
                ↓             ↓       Note Field       ↓
           Assinatura    128-bit    Imutável      NFC Tag
           Pós-Quântica   Token                   Física
```

### Stack Tecnológico

| Componente | Tecnologia | Versão |
|------------|------------|--------|
| Post-Quantum Crypto | Falcon-512 (liboqs) | ≥ 0.9.0 |
| KDF | HKDF-SHA3-256 | RFC 5869 |
| Blockchain | Algorand | Testnet/Mainnet |
| NFC Chip | NTAG 424 DNA | NT4H2421Gx |
| NFC Reader | ACR122U | ACS Driver v5+ |
| Backend | Node.js + TypeScript | 20+ |

---

## 2. Fluxo Completo (9 Etapas)

### Diagrama de Sequência

```
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐    ┌────────┐
│ Backend │    │ Falcon   │    │   DAT   │    │ Algorand │    │ ACR122U│
└────┬────┘    └────┬─────┘    └────┬────┘    └────┬─────┘    └────┬───┘
     │              │               │              │               │
     │─── [1] Generate Keypair ────>│              │               │
     │<────── Public + Private ──────│              │               │
     │              │               │              │               │
     │─── [2] Sign Metadata ───────>│              │               │
     │<────── Falcon Hash ───────────│              │               │
     │              │               │              │               │
     │─── [3] Derive DAT ──────────────────────────>│               │
     │<────── DAT (16 bytes) ────────────────────────│               │
     │              │               │              │               │
     │─── [4] Create ARC-89 ────────────────────────────────────────>│
     │<────── Asset ID ──────────────────────────────────────────────│
     │              │               │              │               │
     │─── [5] Anchor Hash ─────────────────────────────────────────>│
     │<────── TX ID + Block ─────────────────────────────────────────│
     │              │               │              │               │
     │─── [6] Prepare NTAG Layout ─>│              │               │
     │<────── 144 bytes ─────────────│              │               │
     │              │               │              │               │
     │─── [7] Check Reader ──────────────────────────────────────────>│
     │<────── Status OK ─────────────────────────────────────────────│
     │              │               │              │               │
     │─── [8] Write QTAG ────────────────────────────────────────────>│
     │<────── Write OK ──────────────────────────────────────────────│
     │              │               │              │               │
     │─── [9] Lock Config ───────────────────────────────────────────>│
     │<────── Locked ────────────────────────────────────────────────│
     │              │               │              │               │
```

### Detalhamento por Etapa

#### ETAPA 1: Gerar Falcon-512 Keypair

**Objetivo:** Criar par de chaves pós-quânticas

**Processo:**
```typescript
const falconKeys = await falconService.generateKeyPair();
// {
//   publicKey: Buffer(897 bytes),
//   privateKey: Buffer(1281 bytes),
//   publicKeyHash: "0xABC..." (SHA3-256)
// }
```

**Armazenamento:**
- ❌ **Private Key:** NUNCA armazena no banco → HSM/Vault offline
- ✅ **Public Key:** Banco criptografado (AES-256-GCM)
- ✅ **Public Key Hash:** Referência pública

**Tabela:** `FalconKeys`

---

#### ETAPA 2: Assinar Metadata → Falcon Hash

**Objetivo:** Gerar hash raiz de integridade

**Processo:**
```typescript
const falconHashResult = await falconService.generateEntityHash(
  entityId,
  entityType,
  metadata,
  privateKey, // ⚠️ HSM em produção
  publicKeyHash
);
// {
//   falconHash: "0x123...", // 64 bytes (512 bits)
//   publicKeyHash: "0xABC...",
//   truncatedHash: "0x456..." // 32 bytes para Algorand
// }
```

**Payload Assinado:**
```json
{
  "entityId": "prod_123",
  "entityType": "PRODUCT",
  "metadata": {
    "name": "Smartphone XYZ",
    "sku": "SMRT-001",
    "category": "Eletrônicos"
  },
  "timestamp": "2025-01-27T00:00:00Z"
}
```

**Assinatura:** 666 bytes (Falcon-512)

**Hash Final:** SHA3-512(signature) = 64 bytes

---

#### ETAPA 3: Derivar DAT via HKDF-SHA3

**Objetivo:** Criar token de autenticação derivado

**Algoritmo:** HKDF-SHA3-256 (RFC 5869)

**Parâmetros:**
```typescript
IKM = Falcon Hash (64 bytes) + UID (7 bytes)
Salt = UID do NTAG (7 bytes)
Info = "QTAG-DAT-v1"
Output = 32 bytes → Truncar para 16 bytes
```

**Código:**
```typescript
const datResult = datService.deriveDAT(falconHash, ntagUID);
// {
//   fullDAT: Buffer(32 bytes),
//   truncatedDAT: Buffer(16 bytes), // ← VAI PARA NTAG
//   datHash: "0x789..." (SHA3-256 hex)
// }
```

**Por que 16 bytes?**
- NTAG tem espaço limitado (144 bytes totais)
- 128 bits = segurança adequada
- Permite verificação rápida

---

#### ETAPA 4: Criar ARC-89 Metadata Registry

**Objetivo:** Registro mutável de metadata no Algorand

**Processo:**
```typescript
const arc89Metadata = {
  entityId: "prod_123",
  entityType: "PRODUCT",
  name: "Smartphone XYZ",
  category: "Eletrônicos",
  ownerId: "user_456",
  createdAt: new Date(),
  metadata: { ... }
};

const arc89Id = await algorandService.createARC89Registry(arc89Metadata);
// 781233
```

**Algorand ASA (Asset):**
- Total: 1 (NFT único)
- Unit Name: "QTAG"
- Asset Name: "QTAG-PRODUCT"
- Manager: Quantum Cert Account
- URL: `https://quantum-cert.com/arc89/{entityId}`

**Metadata JSON:**
```json
{
  "standard": "arc89",
  "name": "Smartphone XYZ",
  "description": "PRODUCT: prod_123",
  "properties": {
    "entity_id": "prod_123",
    "entity_type": "PRODUCT",
    "category": "Eletrônicos",
    "owner_id": "user_456",
    "created_at": "2025-01-27T00:00:00Z"
  },
  "extra": { ... }
}
```

---

#### ETAPA 5: Ancorar no Algorand (Note Field)

**Objetivo:** Registro imutável no blockchain

**Payload Note Field:**
```json
{
  "proto": "QC-1.0",
  "falcon_hash": "0x456...", // 32 bytes truncado
  "dat_hash": "0x789...",     // SHA3-256 do DAT
  "ntag_uid": "0x04AABBCCDD",
  "arc89_id": 781233,
  "ts": 1737338291
}
```

**Transação Algorand:**
```typescript
const txn = makePaymentTxnWithSuggestedParamsFromObject({
  from: quantumCertAccount,
  to: quantumCertAccount, // Self-payment (0 ALGO)
  amount: 0,
  note: Buffer.from(JSON.stringify(payload))
});
```

**Resultado:**
```json
{
  "txId": "ALGO_TX_ABC123...",
  "blockHeight": 12345678,
  "timestamp": "2025-01-27T00:00:00Z"
}
```

**Verificação:**
- ✅ Imutável (never changes)
- ✅ Auditável (public blockchain)
- ✅ Quantum-ready (Falcon hash)

---

#### ETAPA 6: Preparar Layout NTAG

**Objetivo:** Estruturar dados para NTAG 424 DNA

**Mapa de Memória (144 bytes):**

| Offset | Bytes | Conteúdo | Valor Exemplo |
|--------|-------|----------|---------------|
| 0-1 | 2 | Versão protocolo | `0x0100` (v1.0) |
| 2-9 | 8 | UID truncado | `0x04AABBCCDD...` |
| 10-25 | 16 | DAT truncado | `0x123456...` |
| 26-57 | 32 | Falcon Hash truncado | `0xABCDEF...` |
| 58-61 | 4 | ARC-89 Pointer | `0x000BEAB1` (781233) |
| 62-95 | 34 | Metadata Checksum | SHA3-256 + CRC16 |
| 96-143 | 48 | Reservado | `0x00...` |

**Código:**
```typescript
const qtagData = qtagService.createQTAGLayout(
  metadata,
  ntagUID,
  datTruncated,
  falconHashTruncated,
  arc89Id
);
// {
//   layout: { version, uid, dat, ... },
//   fullBuffer: Buffer(144 bytes),
//   pages: [Buffer(4), Buffer(4), ...] // 36 páginas
// }
```

**Divisão em Páginas:**
- 144 bytes ÷ 4 bytes/página = 36 páginas
- Páginas 4-39 (User Memory)

---

#### ETAPA 7: Verificar Leitor NFC

**Objetivo:** Confirmar ACR122U conectado e tag presente

**Código:**
```typescript
const readerStatus = await acr122uService.getReaderStatus();
// {
//   connected: true,
//   readerName: "ACS ACR122U PICC Interface",
//   firmwareVersion: "v2.15",
//   tagPresent: true,
//   tagUID: "0x04AABBCCDD...",
//   tagType: "NTAG 424 DNA"
// }
```

**Validações:**
- ✅ Reader conectado
- ✅ Tag presente
- ✅ UID match
- ✅ Tipo correto (NTAG 424 DNA)

---

#### ETAPA 8: Gravar QTAG

**Objetivo:** Escrever dados no NTAG 424 DNA

**Sequência:**

1. **Autenticar (AES-128)**
```typescript
const auth = await acr122uService.authenticate(0x01, writeKey);
// APDU: 90 71 00 00 02 01 00
```

2. **Escrever Páginas (Sequencial)**
```typescript
for (let i = 0; i < pages.length; i++) {
  const pageNumber = 4 + i; // Start at page 4
  const pageData = pages[i]; // 4 bytes
  
  // APDU: 90 D6 00 <PAGE> 04 <DATA>
  await sendAPDU(`90 D6 00 ${pageNumber.toString(16)} 04 ${pageData.toString('hex')}`);
}
```

3. **Verificar Escrita**
```typescript
const readData = await acr122uService.readQTAG(4, 36);
const verified = readData.equals(fullBuffer);
```

**Resultado:**
```json
{
  "success": true,
  "bytesWritten": 144,
  "pages": [4, 5, 6, ..., 39]
}
```

---

#### ETAPA 9: Lock Configuration (Opcional)

**Objetivo:** Bloquear configuração (irreversível)

⚠️ **ATENÇÃO:** Após lock, a tag NÃO PODE ser reconfigurada!

**Processo:**
```typescript
const locked = await acr122uService.lockConfiguration(masterKey);
// APDU: 90 5C 00 00
```

**Efeito:**
- ✅ Write protection ativada
- ✅ SUN/CMAC permanente
- ✅ Access keys permanentes
- ❌ Não pode mudar chaves
- ❌ Não pode desabilitar SUN

**Quando usar:**
- ✅ Produção final
- ❌ Testes/desenvolvimento

---

## 3. Componentes Técnicos

### 3.1 Falcon-512 (liboqs)

**Instalação:**
```bash
# Ubuntu/Debian
sudo apt-get install liboqs-dev

# macOS
brew install liboqs

# Python wrapper
pip install liboqs-python --break-system-packages
```

**Verificar:**
```bash
python3 -c "import oqs; print(oqs.get_enabled_sig_mechanisms())"
# Deve incluir 'Falcon-512'
```

**Chaves:**
- Public Key: 897 bytes
- Private Key: 1281 bytes
- Signature: 666 bytes

---

### 3.2 DAT (HKDF-SHA3-256)

**Biblioteca:** Node.js `crypto` built-in

**Implementação:**
```typescript
import crypto from 'crypto';

function hkdfSHA3(ikm, salt, info, length) {
  // Extract
  const prk = crypto.createHmac('sha3-256', salt).update(ikm).digest();
  
  // Expand
  let t = Buffer.alloc(0);
  let okm = Buffer.alloc(0);
  
  for (let i = 1; i <= Math.ceil(length / 32); i++) {
    const tInfo = Buffer.concat([t, info, Buffer.from([i])]);
    t = crypto.createHmac('sha3-256', prk).update(tInfo).digest();
    okm = Buffer.concat([okm, t]);
  }
  
  return okm.slice(0, length);
}
```

---

### 3.3 Algorand SDK

**Instalação:**
```bash
npm install algosdk
```

**Configuração:**
```typescript
import algosdk from 'algosdk';

const server = 'https://testnet-api.algonode.cloud';
const token = '';
const algodClient = new algosdk.Algodv2(token, server, '');

const mnemonic = process.env.ALGORAND_QC_ACCOUNT_MNEMONIC;
const account = algosdk.mnemonicToSecretKey(mnemonic);
```

---

### 3.4 ACR122U + pyscard

**Instalação:**

1. **Driver ACS:**
```bash
# Download de https://www.acs.com.hk/en/driver/3/acr122u-usb-nfc-reader/
wget https://www.acs.com.hk/download-driver-unified/11559/ACS-Unified-Driver-Lnx-Mac-125-P.zip
unzip ACS-Unified-Driver-Lnx-Mac-125-P.zip
cd acsccid*
sudo ./install.sh
```

2. **pyscard:**
```bash
sudo apt-get install pcscd pcsc-tools
pip3 install pyscard --break-system-packages
```

3. **Verificar:**
```bash
pcsc_scan
# Deve detectar ACR122U
```

---

## 4. Setup e Instalação

### 4.1 Variáveis de Ambiente

```env
# Algorand
ALGORAND_QC_ACCOUNT_MNEMONIC="word1 word2 ... word25"
ALGORAND_ALGOD_SERVER="https://testnet-api.algonode.cloud"
ALGORAND_NETWORK="testnet"

# Falcon
FALCON_ENCRYPTION_KEY="256-bit-hex-key"
LIBOQS_PATH="/usr/local/bin/oqs"

# NTAG
NTAG_MASTER_KEY="32-hex-chars-aes128"
NTAG_WRITE_KEY="32-hex-chars-aes128"
NTAG_SUN_KEY="32-hex-chars-aes128"
```

### 4.2 Instalação Completa

```bash
# 1. Clonar projeto
git clone https://github.com/vmont3/qc-backend.git
cd qc-backend

# 2. Instalar dependências Node.js
npm install

# 3. Instalar liboqs
sudo apt-get install liboqs-dev

# 4. Instalar driver ACR122U
wget https://www.acs.com.hk/.../ACS-Unified-Driver...
sudo ./install.sh

# 5. Instalar pyscard
pip3 install pyscard --break-system-packages

# 6. Configurar .env
cp .env.example .env
nano .env

# 7. Executar migrations
npx prisma migrate deploy
npx prisma generate

# 8. Build
npm run build

# 9. Iniciar
npm start
```

---

## 5. API Reference

### 5.1 Admin - Encoding Queue

**GET `/api/admin/encoding/queue`**

Lista fila de gravação

Query params:
- `status`: PENDING | IN_PROGRESS | COMPLETED | FAILED
- `limit`: número (default: 50)

Response:
```json
[
  {
    "id": "queue_123",
    "entityType": "PRODUCT",
    "status": "PENDING",
    "product": {
      "id": "prod_456",
      "name": "Smartphone XYZ",
      "sku": "SMRT-001"
    },
    "createdAt": "2025-01-27T00:00:00Z"
  }
]
```

---

**POST `/api/admin/encoding/start`**

Iniciar gravação QTAG

Request:
```json
{
  "queueId": "queue_123",
  "ntagUID": "04AABBCCDDEE",
  "writeKey": "0123456789ABCDEF...",
  "lockAfterWrite": false,
  "stationId": "station_1"
}
```

Response (Sucesso):
```json
{
  "success": true,
  "qtagData": {
    "falconHash": "0xABC...",
    "datHash": "0x123...",
    "arc89Id": 781233,
    "algorandTxId": "ALGO_TX...",
    "blockHeight": 12345678,
    "ntagUID": "04AABBCCDDEE"
  },
  "queueId": "queue_123"
}
```

Response (Erro):
```json
{
  "error": "Encoding failed",
  "details": "Write failed at page 15",
  "step": "8"
}
```

---

**GET `/api/admin/encoding/reader-status`**

Status do leitor NFC

Response:
```json
{
  "connected": true,
  "readerName": "ACS ACR122U PICC Interface",
  "firmwareVersion": "v2.15",
  "tagPresent": true,
  "tagUID": "04AABBCCDDEE",
  "tagType": "NTAG 424 DNA"
}
```

---

**POST `/api/admin/encoding/verify`**

Verificar QTAG gravada

Request:
```json
{
  "ntagUID": "04AABBCCDDEE"
}
```

Response:
```json
{
  "valid": true,
  "data": {
    "entityId": "prod_456",
    "entityType": "PRODUCT",
    "arc89Id": 781233,
    "algorandTxId": "ALGO_TX...",
    "blockHeight": 12345678,
    "verified": true
  }
}
```

---

## 6. Troubleshooting

### 6.1 Falcon-512

**Erro:** `liboqs not found`

**Solução:**
```bash
sudo apt-get install liboqs-dev
# Ou compilar do source:
git clone https://github.com/open-quantum-safe/liboqs.git
cd liboqs
mkdir build && cd build
cmake -DCMAKE_INSTALL_PREFIX=/usr/local ..
make && sudo make install
```

---

### 6.2 ACR122U

**Erro:** `No readers found`

**Solução:**
```bash
# 1. Verificar USB
lsusb | grep ACS
# Deve mostrar: Bus 001 Device 003: ID 072f:2200 Advanced Card Systems, Ltd ACR122U

# 2. Restart pcscd
sudo systemctl restart pcscd

# 3. Verificar permissões
sudo chmod 666 /dev/bus/usb/001/003
```

---

**Erro:** `Authentication failed`

**Solução:**
- Verificar chave AES-128 correta
- NTAG pode estar com chaves padrão:
  - Key 0x00-0x03: `00000000000000000000000000000000`

---

### 6.3 Algorand

**Erro:** `Insufficient funds`

**Solução:**
```bash
# Obter ALGO de teste (testnet)
# https://bank.testnet.algorand.network/
# Cole seu endereço e solicite 10 ALGO
```

---

**Erro:** `Transaction pool full`

**Solução:**
- Aguardar 4-5 segundos entre transações
- Usar `suggestedParams` da API (fees dinâmicos)

---

## 📚 Referências

- [liboqs Documentation](https://github.com/open-quantum-safe/liboqs)
- [NTAG 424 DNA Datasheet](https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf)
- [Algorand Developer Portal](https://developer.algorand.org)
- [ACR122U Manual](https://www.acs.com.hk/download-manual/419/ACR122U-A9.pdf)
- [RFC 5869 - HKDF](https://tools.ietf.org/html/rfc5869)

---

**Documento criado em:** 27/01/2025  
**Versão:** 1.0  
**Autor:** Quantum Cert Team
