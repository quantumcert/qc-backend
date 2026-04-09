# 🚀 Procedimento de Deploy / Migration

## 1. Configurar Ambiente

O sistema requer as seguintes variáveis de ambiente críticas no ficheiro `.env`:

```bash
# PostgreSQL Connection String
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<database>"

# NTAG 424 DNA Keys (NFC)
NTAG_MASTER_KEY="<32-hex-chars>"
NTAG_WRITE_KEY="<32-hex-chars>"
NTAG_SUN_KEY="<32-hex-chars>"
```

## 2. Executar Migration (Crítico)

Esta migration adiciona as colunas de segurança `fingerprint` (Business Key) e `ntagUID` (Anti-Clonagem).

```bash
npx prisma migrate dev --name add_fingerprint_and_ntag_binding
```

Se estiver em produção (sem migrate dev):

```bash
npx prisma migrate deploy
```

## 3. Verificar Integridade

Após a migration, verificar se a tabela `Asset` possui:
- `fingerprint` (String, unique, nullable)
- `ntagUID` (String, unique, nullable)
- `ntagEncodedAt` (DateTime, nullable)

## 4. Regenerar Cliente

```bash
npx prisma generate
```

## 5. Build & Start

```bash
npm run build
npm start
```
