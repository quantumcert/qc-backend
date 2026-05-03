# Quantum Cert - Backend API

Backend da plataforma Quantum Cert para identificação física com registro em blockchain.

## 🎯 Sobre o Projeto

Quantum Cert é uma plataforma de rastreabilidade e identificação física que utiliza:
- **Blockchain Algorand** para registros imutáveis
- **Criptografia Falcon-512** pós-quântica
- **QTAG (NFC Tags)** NTAG 424 DNA para identificação física
- **Sistema de Comissionamento** com genealogia (Pai/Mãe/Referrer)

## 🚀 Tecnologias

- **Node.js 20+** + **Express** - Framework web
- **TypeScript** - Type safety
- **Prisma** - ORM para banco de dados
- **PostgreSQL** - Banco de dados relacional
- **Algorand** - Blockchain para registros imutáveis
- **JWT** - Autenticação
- **Zod** - Validação de schemas

## 📦 Instalação

```bash
# Clonar repositório
git clone https://github.com/vmont3/qc-backend.git
cd qc-backend

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env com suas credenciais

# Executar migrations do banco de dados
npx prisma migrate deploy

# Gerar Prisma Client
npx prisma generate

# Build do projeto
npm run build
```

## 🔧 Desenvolvimento

```bash
# Modo desenvolvimento (hot reload)
npm run dev

# Build para produção
npm run build

# Iniciar em produção
npm start

# Executar testes
npm test
```

## 🚂 Deploy na Railway

### 1. Preparar Repositório

```bash
git add .
git commit -m "Initial commit - Quantum Cert Backend"
git push origin main
```

### 2. Configurar Railway

1. Acesse [Railway.app](https://railway.app)
2. Crie novo projeto
3. Conecte seu repositório GitHub
4. Adicione PostgreSQL database

### 3. Variáveis de Ambiente

Configure as seguintes variáveis no Railway:

```env
DATABASE_URL=postgresql://... (fornecido automaticamente pelo Railway)
JWT_SECRET=seu-secret-super-seguro-aqui
ALGORAND_QC_ACCOUNT_MNEMONIC=suas 25 palavras da carteira algorand aqui
ALGORAND_ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGORAND_ALGOD_TOKEN=
ALGORAND_NETWORK=testnet
NODE_ENV=production
PORT=3000
```

### 4. Deploy Automático

O Railway detectará automaticamente o projeto Node.js e fará deploy usando o `railway.json`.

## 📚 Documentação da API

### Autenticação

#### Registrar Usuário
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "senha123",
  "document": "12345678900",
  "userType": "PESSOA"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "senha123"
}
```

#### Verificar Token
```http
GET /api/auth/verify
Authorization: Bearer {token}
```

### Produtos

#### Criar Produto
```http
POST /api/products
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Produto Teste",
  "description": "Descrição do produto",
  "category": "Eletrônicos",
  "sku": "PROD-001",
  "manufacturerId": "manufacturer-id",
  "sellerId": "seller-id"
}
```

#### Buscar Produto
```http
GET /api/products/:productId
```

### Transferências

#### Iniciar Transferência
```http
POST /api/transfers/initiate
Authorization: Bearer {token}
Content-Type: application/json

{
  "productId": "product-id",
  "toUserId": "buyer-user-id",
  "transferFee": 50.00
}
```

#### Comprador Confirma
```http
PUT /api/transfers/:transferId/confirm-buyer
Authorization: Bearer {token}
```

#### Completar Transferência
```http
POST /api/transfers/:transferId/complete
Authorization: Bearer {token}
Content-Type: application/json

{
  "blockchainTxId": "algorand-tx-id",
  "blockHeight": 12345
}
```

### Pets (QTAGPET)

#### Registrar Pet
```http
POST /api/pets
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Rex",
  "species": "Cão",
  "breed": "Labrador",
  "gender": "M",
  "birthDate": "2020-01-15"
}
```

### Incidentes (Sistema de Recuperação)

#### Reportar Sinistro
```http
POST /api/incidents/report
Authorization: Bearer {token}
Content-Type: application/json

{
  "entityType": "PRODUCT",
  "productId": "product-id",
  "incidentType": "ROUBADO",
  "description": "Produto roubado em...",
  "policeReport": "BO123456",
  "lastKnownLocation": "São Paulo, SP"
}
```

## 🏗️ Arquitetura

### Modelos do Banco de Dados (18 Modelos)

1. **User** - Usuários do sistema
2. **UserProfile** - Perfis de usuários
3. **UserPet** - Pets com genealogia
4. **Product** - Produtos
5. **UserProduct** - Propriedade de produtos
6. **ProductBatch** - Lotes com Merkle Root
7. **ProductTransfer** - Transferências
8. **TransferSignature** - Assinaturas digitais
9. **TagEncodingQueue** - Fila de gravação de tags
10. **Delegation** - Delegação de auditores
11. **DataUpdate** - Histórico de atualizações
12. **BlockchainAnchor** - Ancoragens no Algorand
13. **Company** - Empresas
14. **IncidentReport** - Relatórios de sinistros
15. **IncidentUpdate** - Atualizações de sinistros
16. **EntityRecoveryStatus** - Status de recuperação
17. **StatusHistory** - Histórico de status
18. **PublicRecoveryView** - Visualização pública

### Fluxo de Transferência

1. **Vendedor inicia** → `PENDING_BUYER_CONFIRMATION`
2. **Comprador confirma** → `PAYMENT_PENDING`
3. **Pagamento processado** → `PAYMENT_CONFIRMED`
4. **Registro blockchain** → `COMPLETED`

### Sistema de Comissionamento

- **Pai (Indústria)**: Fabricante original
- **Mãe (Lojista)**: Distribuidor/Vendedor
- **Referrer**: Sistema de indicação
- **Taxa**: 5% por transferência (< 90 dias)

## 🔐 Segurança

- ✅ Autenticação JWT
- ✅ Bcrypt para senhas (10 rounds)
- ✅ Validação com Zod
- ✅ Helmet para headers HTTP
- ✅ CORS configurado
- ✅ Merkle Root Hash para assinatura digital
- ✅ Registro imutável no Algorand

## 📝 Variáveis de Ambiente

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | URL do PostgreSQL | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Secret para JWT | `your-256-bit-secret` |
| `JWT_EXPIRES_IN` | Expiração do token | `24h` |
| `ALGORAND_QC_ACCOUNT_MNEMONIC` | 25 palavras da carteira | `word1 word2 ...` |
| `ALGORAND_ALGOD_SERVER` | Servidor Algorand | `https://testnet-api.algonode.cloud` |
| `ALGORAND_NETWORK` | Rede Algorand | `testnet` ou `mainnet` |
| `PORT` | Porta do servidor | `3000` |
| `NODE_ENV` | Ambiente | `development` ou `production` |

## 🧪 Testes

```bash
# Executar todos os testes
npm test

# Testes end-to-end
npm run test:e2e
```

## 📄 Licença

MIT © Quantum Cert

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📞 Suporte

Para suporte, entre em contato através do GitHub Issues.

---

**Desenvolvido com ❤️ pela equipe Quantum Cert**
