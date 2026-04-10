# Sub-sistema 3 — Document Verification (Zero-Knowledge)

**Data:** 2026-04-09  
**Status:** Design aprovado — pronto para implementação  
**Ordem de execução:** 3 (após Sub-sistema 1 — Core Gap Closure)

---

## 1. Objetivo

Permitir que qualquer auditor (juiz, perito, terceiro) verifique a autenticidade de um documento físico (PDF, laudo, contrato) sem nunca enviá-lo ao backend. Somente o hash SHA3-512 do arquivo circula pela rede. O documento permanece sob soberania local de quem o detém.

---

## 2. Arquitetura Geral

```
[Tenant / Perito]                        [Auditor / Juiz]
     │                                         │
     │ Calcula SHA3-512 do PDF localmente      │ Arrasta PDF no browser
     │ Envia documentHash na criação do evento │ Browser calcula SHA3-512
     ▼                                         ▼
POST /api/v1/diamond                  GET /api/v1/verify/document/:hash
{ selector: recordAuthenticatedEvent  ──────────────────────────────────►
  payload: { documentHash, assetId,            DocumentVerificationFacet
             payload: { type, expertId,        Busca por EventLog.documentHash
                        falconSignature, ... } Retorna prova de ancoragem
           }                                   200 | 404 | 400
}
     │
     ▼
EventLog.documentHash = "128-char-hex"
EventLog.dltTxId = "ALGO-TX-..." (via AnchorQueueService)
```

**Princípio:** O arquivo físico **nunca** chega ao backend. Nem no registro, nem na verificação. Zero-Knowledge by design.

---

## 3. Mudança de Schema

### 3.1 Campo novo no `EventLog`

```prisma
model EventLog {
  // ... campos existentes inalterados ...

  signatureHash String?  // SHA3-512 do JSON.stringify(payload) — semântica inalterada
  documentHash  String?  // SHA3-512 do arquivo físico (PDF, laudo, contrato)
  dltTxId       String?

  @@index([documentHash])   // índice dedicado para lookup O(log n)
  // ... índices existentes ...
}
```

**Por que campo separado:** `signatureHash` é SHA3-512 do payload JSON inteiro — valor diferente do hash do arquivo físico. Mesclar os dois quebraria a semântica de ancoragem existente.

### 3.2 Migration

```bash
npm run db:migrate  # gera e aplica migration: add_documentHash_to_event_log
```

---

## 4. Mudança no `EventLogFacet`

### 4.1 `recordAuthenticatedEvent`

O método extrai `documentHash` do payload de entrada e salva no campo dedicado. Se não vier, o campo fica `null` — evento normal, sem documento ancorado.

```typescript
// Extração dentro de recordAuthenticatedEvent (após resolução do assetId/payload)
const { documentHash: rawDocumentHash, payload: innerPayload, ...rest } = requestPayload;
const documentHash = rawDocumentHash ?? null;
const payload = innerPayload ?? rest;

// Criação do EventLog
await tx.eventLog.create({
  data: {
    assetId,
    tenantId: asset.tenantId,
    issuerId: apiKeyId || origin,
    origin: ...,
    status: 'APPROVED',
    payload,
    signatureHash,   // SHA3-512 do payload JSON — comportamento existente
    documentHash     // SHA3-512 do arquivo físico — novo campo
  }
});
```

**Validação:** Se `documentHash` vier no payload, deve ser uma string hex de exatamente 128 caracteres. Caso contrário, rejeitar com 400.

---

## 5. `DocumentVerificationFacet`

Novo Facet em `src/services/core-facets/DocumentVerificationFacet.ts`.

```typescript
export class DocumentVerificationFacet {
  static async verifyByHash(hash: string): Promise<VerificationResult> {
    // 1. Validar formato: /^[a-f0-9]{128}$/i
    if (!/^[a-f0-9]{128}$/i.test(hash)) {
      return { verified: false, reason: 'Invalid hash format' };
    }

    // 2. Busca direta por índice
    const event = await prisma.eventLog.findFirst({
      where: { documentHash: hash },
      include: { asset: { select: { status: true } } }
    });

    // 3. Não encontrado
    if (!event) {
      return { verified: false, reason: 'Document not found in registry' };
    }

    // 4. Encontrado — retornar prova
    return {
      verified: true,
      assetId: event.assetId,
      assetStatus: event.asset.status,
      dltTxId: event.dltTxId,
      anchoredAt: event.updatedAt,
      eventId: event.id,
      issuerId: event.issuerId
    };
  }
}
```

**Sem `secureContext`:** Facet público — não recebe contexto de tenant. Retorna apenas dados que já são publicamente verificáveis (prova de ancoragem).

---

## 6. Rota Pública

Adicionada em `src/routes/v1/publicRoutes.ts` — sem `requireApiKey`, sem `requireIdempotency`.

```typescript
import { DocumentVerificationFacet } from '../../services/core-facets/DocumentVerificationFacet';

// Verificação pública de documento por hash SHA3-512
router.get('/verify/document/:hash', async (req, res, next) => {
  try {
    const result = await DocumentVerificationFacet.verifyByHash(req.params.hash);
    const statusCode = result.verified ? 200 : (result.reason === 'Invalid hash format' ? 400 : 404);
    res.status(statusCode).json(result);
  } catch (err) {
    next(err);
  }
});
```

**Path:** `GET /api/v1/public/verify/document/:hash` (montado sob o prefixo `/public` em `routes/index.ts`)

---

## 7. Contrato de API

### 7.1 Registro de documento (tenant/perito)

```http
POST /api/v1/diamond
X-API-Key: qc_...
X-Idempotency-Key: uuid-v4

{
  "selector": "recordAuthenticatedEvent",
  "payload": {
    "assetId": "cuid...",
    "documentHash": "a1b2c3...128-char-sha3-512-hex",
    "payload": {
      "type": "EXPERT_REPORT",
      "expertId": "qc_abc...",
      "falconSignature": "...",
      "crspng": "..."
    }
  }
}
```

### 7.2 Verificação pública (auditor/juiz)

```http
GET /api/v1/public/verify/document/a1b2c3...128-char-hex
```

**200 — Documento autêntico:**
```json
{
  "verified": true,
  "assetId": "clxxx...",
  "assetStatus": "ACTIVE",
  "dltTxId": "ALGO-TX-abc123",
  "anchoredAt": "2026-03-10T14:22:00Z",
  "eventId": "clyyy...",
  "issuerId": "qc_abc..."
}
```

**404 — Não encontrado / adulterado:**
```json
{ "verified": false, "reason": "Document not found in registry" }
```

**400 — Hash malformado:**
```json
{ "verified": false, "reason": "Invalid hash format" }
```

---

## 8. Fluxo de Dados Completo

```
1. Perito calcula SHA3-512(PDF) localmente
2. POST /api/v1/diamond { documentHash, payload: { type, expertId, falconSignature, crspng } }
3. EventLogFacet salva: EventLog { documentHash, signatureHash, status: APPROVED, dltTxId: null }
4. AnchorQueueService processa: ancora signatureHash na Algorand → EventLog.dltTxId = "ALGO-TX-..."

5. Auditor arrasta PDF → browser calcula SHA3-512(PDF)
6. GET /api/v1/public/verify/document/{hash}
7. DocumentVerificationFacet busca por documentHash (índice)
8. Retorna prova: assetId, dltTxId, anchoredAt, issuerId
```

---

## 9. Expert ID

O campo `issuerId` já existente no `EventLog` serve como identificador do perito responsável — é o `apiKeyId` injetado pelo `requireApiKey` middleware no `secureContext`. Sem necessidade de `ExpertRegistryFacet` neste sub-sistema.

---

## 10. Dependências

| Dependência | Status | Bloqueante? |
|---|---|---|
| Sub-sistema 1 (SchedulerService, EventLog populado) | Spec aprovado, pendente implementação | Não — funciona com dados já existentes |
| Sub-sistema 2 (DLT Workers) | Pendente | Não — lê `dltTxId` já gravado pelo Algorand adapter existente |

---

## 11. O que NÃO está neste sub-sistema

- Frontend (Drag & Drop com WebCrypto SHA3-512) — responsabilidade do cliente/frontend team
- Timeline pública do ativo (UX do auditor após verificação) — depende de rotas existentes de leitura do asset
- Validação da assinatura Falcon-512 do perito — Sub-sistema 4 (M2M / Agent Registry)
- Multi-chain: `dltTxId` retornado reflete o adapter atual (Algorand). Campo `chain` pode ser adicionado quando Sub-sistema 2 estiver implementado.

---

## 12. Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `prisma/schema.prisma` | Adicionar `documentHash String?` + `@@index([documentHash])` ao `EventLog` |
| `src/services/core-facets/DocumentVerificationFacet.ts` | Criar |
| `src/services/core-facets/EventLogFacet.ts` | Extrair `documentHash` do payload de entrada em `recordAuthenticatedEvent` |
| `src/routes/v1/publicRoutes.ts` | Adicionar `GET /verify/document/:hash` |
