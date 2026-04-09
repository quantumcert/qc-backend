# 🔐 Quantum Cert Backend - Quantum-Ready Edition

Backend completo com integração **Falcon-512** (pós-quântico), **NTAG 424 DNA**, e **Algorand blockchain**.

---

## ✨ Novidades desta Versão

### 🔐 Criptografia Pós-Quântica
- ✅ **Falcon-512** via liboqs
- ✅ Assinatura digital quantum-safe
- ✅ Chaves públicas armazenadas com AES-256-GCM

### 🏷️ Integração NTAG 424 DNA
- ✅ Mapa de memória completo (144 bytes)
- ✅ DAT (Derived Authentication Token) via HKDF-SHA3-256
- ✅ Suporte ACR122U NFC reader
- ✅ Gravação e verificação automática

### ⛓️ Blockchain Algorand Híbrido
- ✅ **Note Field** - Âncora imutável
- ✅ **ARC-89** - Metadata Registry mutável
- ✅ Verificação on-chain

### 🎛️ Painel Admin
- ✅ Fila de gravação
- ✅ Estação de encoding NFC
- ✅ Monitoramento em tempo real
- ✅ Estatísticas de produção

---

## 🚀 Instalação Rápida

### Pré-requisitos

```bash
# Node.js 20+
node --version

# PostgreSQL 14+
psql --version

# Python 3.8+ (para NFC)
python3 --version
```

### 1. Clonar e Instalar

```bash
git clone https://github.com/vmont3/qc-backend.git
cd qc-backend
npm install
```

### 2. Instalar liboqs (Falcon-512)

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install liboqs-dev
```

**macOS:**
```bash
brew install liboqs
```

**Verificar:**
```bash
python3 -c "import oqs; print('Falcon-512' in oqs.get_enabled_sig_mechanisms())"
```

### 3. Instalar ACR122U Driver + pyscard

**Driver ACS:**
```bash
wget https://www.acs.com.hk/download-driver-unified/11559/ACS-Unified-Driver-Lnx-Mac-125-P.zip
unzip ACS-Unified-Driver-Lnx-Mac-125-P.zip
cd acsccid*
sudo ./install.sh
```

**pyscard:**
```bash
sudo apt-get install pcscd pcsc-tools
pip3 install pyscard --break-system-packages
```

**Verificar:**
```bash
pcsc_scan
# Conecte o ACR122U - deve aparecer
```

### 4. Configurar Variáveis

```bash
cp .env.example .env
nano .env
```

**Mínimo necessário:**
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/quantum_cert"
JWT_SECRET="seu-secret-256-bits"
ALGORAND_QC_ACCOUNT_MNEMONIC="suas 25 palavras aqui"
FALCON_ENCRYPTION_KEY="64-hex-chars-para-aes-256"
```

### 5. Banco de Dados

```bash
npx prisma migrate deploy
npx prisma generate
```

### 6. Executar

```bash
# Desenvolvimento
npm run dev

# Produção
npm run build
npm start
```

---

## 📡 API Endpoints

### 🔐 Admin - Painel de Gravação

#### Listar Fila
```http
GET /api/admin/encoding/queue?status=PENDING&limit=50
Authorization: Bearer {admin_token}
```

#### Iniciar Gravação
```http
POST /api/admin/encoding/start
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "queueId": "queue_123",
  "ntagUID": "04AABBCCDDEE",
  "writeKey": "0123456789ABCDEF...",
  "lockAfterWrite": false,
  "stationId": "station_1"
}
```

**Resposta (Sucesso):**
```json
{
  "success": true,
  "qtagData": {
    "falconHash": "0xABC...",
    "datHash": "0x123...",
    "arc89Id": 781233,
    "algorandTxId": "ALGO_TX_...",
    "blockHeight": 12345678,
    "ntagUID": "04AABBCCDDEE"
  }
}
```

#### Status do Leitor
```http
GET /api/admin/encoding/reader-status
Authorization: Bearer {admin_token}
```

**Resposta:**
```json
{
  "connected": true,
  "readerName": "ACS ACR122U PICC Interface",
  "tagPresent": true,
  "tagUID": "04AABBCCDDEE",
  "tagType": "NTAG 424 DNA"
}
```

#### Verificar QTAG
```http
POST /api/admin/encoding/verify
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "ntagUID": "04AABBCCDDEE"
}
```

---

## 🔄 Fluxo Completo (9 Etapas)

```
[1] Gerar Falcon-512 Keypair
     ↓
[2] Assinar Metadata → Falcon Hash
     ↓
[3] Derivar DAT via HKDF-SHA3
     ↓
[4] Criar ARC-89 Registry
     ↓
[5] Ancorar no Algorand (Note Field)
     ↓
[6] Preparar Layout NTAG (144 bytes)
     ↓
[7] Verificar ACR122U + Tag
     ↓
[8] Gravar QTAG (autenticação + write + verify)
     ↓
[9] Lock Configuration (opcional)
```

**Tempo médio:** 15-30 segundos por QTAG

---

## 🏗️ Arquitetura

### Serviços Quantum

```
src/services/quantum/
├── FalconService.ts       # Falcon-512 keygen/sign/verify
├── DATService.ts          # HKDF-SHA3-256 derivation
└── QTAGService.ts         # NTAG 424 DNA memory layout
```

### Serviços NFC

```
src/services/nfc/
└── ACR122UService.ts      # ACR122U reader integration
```

### Orquestrador

```
src/services/
└── QTAGOrchestratorService.ts  # Fluxo completo end-to-end
```

### Rotas Admin

```
src/routes/admin/
└── tagEncodingRoutes.ts   # Painel de gravação
```

---

## 📊 Mapa de Memória NTAG

| Offset | Bytes | Conteúdo |
|--------|-------|----------|
| 0-1 | 2 | Versão protocolo (`0x0100`) |
| 2-9 | 8 | UID truncado |
| 10-25 | 16 | **DAT truncado** |
| 26-57 | 32 | **Falcon Hash truncado** |
| 58-61 | 4 | **ARC-89 Pointer** |
| 62-95 | 34 | Metadata checksum |
| 96-143 | 48 | Reservado |

**Total:** 144 bytes (36 páginas x 4 bytes)

---

## 🧪 Testes

### Testar Falcon-512

```bash
python3 -c "
import oqs
sig = oqs.Signature('Falcon-512')
public_key = sig.generate_keypair()
message = b'Test Quantum Cert'
signature = sig.sign(message)
valid = sig.verify(message, signature, public_key)
print(f'Falcon-512 OK: {valid}')
"
```

### Testar ACR122U

```bash
python3 -c "
from smartcard.System import readers
r = readers()
if len(r) > 0:
    print(f'Reader OK: {r[0]}')
    connection = r[0].createConnection()
    connection.connect()
    print('Connected!')
else:
    print('No reader found')
"
```

### Testar Algorand

```bash
curl -X GET https://testnet-api.algonode.cloud/v2/status
```

---

## 🐛 Troubleshooting

### Falcon-512: `liboqs not found`

```bash
# Compilar do source
git clone https://github.com/open-quantum-safe/liboqs.git
cd liboqs
mkdir build && cd build
cmake -DCMAKE_INSTALL_PREFIX=/usr/local ..
make && sudo make install
```

### ACR122U: `No readers found`

```bash
# Verificar USB
lsusb | grep ACS

# Restart daemon
sudo systemctl restart pcscd

# Verificar permissões
sudo chmod 666 /dev/bus/usb/001/00X
```

### Algorand: `Insufficient funds`

```bash
# Obter ALGO de teste (testnet)
# https://bank.testnet.algorand.network/
# Cole seu endereço e solicite 10 ALGO
```

---

## 📚 Documentação Completa

- 📄 [Fluxo QTAG Completo](./docs/technical/FLUXO_QTAG_COMPLETO.md)
- 📄 [Arquitetura Geral](./ARQUITETURA_COMPLETA.md)
- 📄 [Deploy Guide](./DEPLOY_GUIDE.md)

---

## 🔐 Segurança

### Chaves Privadas Falcon

⚠️ **IMPORTANTE:** Private keys NUNCA vão para o banco de dados!

**Produção:**
- ✅ HSM (Hardware Security Module)
- ✅ AWS KMS / Google Cloud KMS
- ✅ Vault (HashiCorp)

**Desenvolvimento:**
- ⚠️ Chaves geradas em memória
- ⚠️ Apenas para testes

### Chaves NTAG

**Padrão de Fábrica:**
```
Key 0x00-0x03: 00000000000000000000000000000000
```

**Produção:**
- ✅ Gerar chaves únicas por lote
- ✅ Armazenar com criptografia
- ✅ Lock após gravação

---

## 🚂 Deploy Railway

Tudo pronto para deploy na Railway com o arquivo `railway.json`.

**Variáveis obrigatórias:**
- `DATABASE_URL` (auto-provisionado)
- `JWT_SECRET`
- `ALGORAND_QC_ACCOUNT_MNEMONIC`
- `FALCON_ENCRYPTION_KEY`
- `NTAG_MASTER_KEY`

---

## 📞 Suporte

- 📖 Documentação: `./docs/technical/`
- 🐛 Issues: GitHub Issues
- 💬 Discord: [Link]

---

**Desenvolvido com ❤️ pela equipe Quantum Cert**  
**Quantum-Ready | Blockchain-Anchored | NFC-Enabled**
