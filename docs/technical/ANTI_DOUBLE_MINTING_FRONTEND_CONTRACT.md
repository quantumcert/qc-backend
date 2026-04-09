# 🛡️ Contrato Frontend — Anti-Double-Minting (Fingerprint)

## Especificação para Equipa de Frontend
**Versão:** 1.0  
**Data:** 17 de Fevereiro de 2026  
**Backend Status:** ✅ Implementado e compilado

---

## 1. Resumo

O Backend agora suporta o campo **`fingerprint`** no endpoint de Minting (`POST /api/v1/assets`).
Este campo é a **Business Key** que impede o registo duplicado de ativos com o mesmo número de série.

### Contrato API

```http
POST /api/v1/assets
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "assetClass": "BICYCLE",
  "customMetadata": {
    "brand": "Caloi",
    "model": "Elite Carbon",
    "frameNumber": "VERUN998877",
    "year": 2025
  },
  "fingerprint": "BICYCLE:VERUN998877"   ← NOVO (opcional)
}
```

### Respostas Possíveis

| HTTP | Significado | Quando |
|------|------------|--------|
| `201 Created` | Ativo criado com sucesso | Fingerprint único ou não fornecido |
| `409 Conflict` | Fingerprint já existe | Tentativa de double-mint |
| `400 Bad Request` | Fingerprint > 255 chars | Validação Zod |
| `402 Payment Required` | Billing pendente | B2C sem pagamento (Mercado Pago) |

### Corpo do Erro 409

```json
{
  "error": "Asset fingerprint already exists. Um ativo com esta identificação já foi registado (ID: cly1abc..., Classe: BICYCLE). Duplicação não é permitida."
}
```

---

## 2. Ajuste no registry.json (Schema dos Formulários)

### Formato Actual (Sem Fingerprint)

```json
{
  "BICYCLE": {
    "label": "Bicicleta",
    "icon": "bicycle",
    "fields": [
      { "name": "brand", "label": "Marca", "type": "text", "required": true },
      { "name": "model", "label": "Modelo", "type": "text", "required": true },
      { "name": "frameNumber", "label": "Nº do Quadro", "type": "text", "required": true },
      { "name": "year", "label": "Ano", "type": "number" }
    ]
  }
}
```

### Formato Novo (Com `isUniqueKey`)

```json
{
  "BICYCLE": {
    "label": "Bicicleta",
    "icon": "bicycle",
    "fields": [
      { "name": "brand", "label": "Marca", "type": "text", "required": true },
      { "name": "model", "label": "Modelo", "type": "text", "required": true },
      {
        "name": "frameNumber",
        "label": "Nº do Quadro",
        "type": "text",
        "required": true,
        "isUniqueKey": true    ← NOVO: marca este campo como Business Key
      },
      { "name": "year", "label": "Ano", "type": "number" }
    ]
  },
  "VEHICLE": {
    "label": "Veículo",
    "icon": "car",
    "fields": [
      { "name": "make", "label": "Fabricante", "type": "text", "required": true },
      { "name": "model", "label": "Modelo", "type": "text", "required": true },
      {
        "name": "chassisNumber",
        "label": "Nº do Chassi",
        "type": "text",
        "required": true,
        "isUniqueKey": true
      },
      { "name": "plate", "label": "Placa", "type": "text" }
    ]
  },
  "FINANCIAL_BOND": {
    "label": "Título Financeiro",
    "icon": "banknote",
    "fields": [
      { "name": "isin", "label": "Código ISIN", "type": "text", "required": true, "isUniqueKey": true },
      { "name": "issuer", "label": "Emissor", "type": "text", "required": true },
      { "name": "maturityDate", "label": "Vencimento", "type": "date" }
    ]
  },
  "QTAG_LIFE": {
    "label": "Identidade Digital (Pessoa/Pet)",
    "icon": "user",
    "fields": [
      { "name": "cpf", "label": "CPF/Registro", "type": "text", "required": true, "isUniqueKey": true },
      { "name": "name", "label": "Nome Completo", "type": "text", "required": true },
      { "name": "birthDate", "label": "Data de Nascimento", "type": "date" }
    ]
  }
}
```

### Regra do `isUniqueKey`

- Máximo **UM** campo por schema pode ter `"isUniqueKey": true`
- Se nenhum campo tem a flag → o `fingerprint` não é enviado (ativo genérico sem serial)
- O campo com `isUniqueKey` pode ter validações adicionais (regex, etc.)

---

## 3. Lógica do DynamicAssetForm

### Pseudo-código

```typescript
// DynamicAssetForm.tsx

function buildFingerprint(assetClass: string, fields: FieldSchema[], formData: Record<string, any>): string | null {
  // 1. Encontrar o campo com isUniqueKey
  const uniqueField = fields.find(f => f.isUniqueKey);
  
  if (!uniqueField) {
    return null; // Ativo genérico — sem fingerprint
  }
  
  const value = formData[uniqueField.name];
  
  if (!value || String(value).trim() === '') {
    return null; // Campo vazio — sem fingerprint (será rejeitado pelo required se obrigatório)
  }
  
  // 2. Concatenar: ASSET_CLASS + ":" + valor (normalizado)
  // O backend normaliza para UPPERCASE, mas enviar já normalizado é boa prática.
  return `${assetClass}:${String(value).trim().toUpperCase()}`;
}

// Na submissão:
async function handleSubmit(formData: Record<string, any>) {
  const fingerprint = buildFingerprint(selectedAssetClass, schema.fields, formData);
  
  const response = await api.post('/api/v1/assets', {
    assetClass: selectedAssetClass,
    customMetadata: formData,
    fingerprint, // null se sem unique key → backend ignora
  });
  
  if (response.status === 409) {
    // Mostrar erro amigável:
    // "Este ativo já foi registado. Verifique o número de série."
    showError('Este ativo já está registado no sistema. Duplicação não é permitida.');
    return;
  }
  
  // Sucesso...
}
```

### Tratamento de Erro 409 (UI)

Recomendações para a experiência do utilizador:

1. **Mensagem clara:** "Um ativo com este número de série já está registado."
2. **Destacar campo:** Marcar o campo `isUniqueKey` com borda vermelha
3. **Sugerir ação:** "Verifique o número de série ou pesquise o ativo existente."
4. **Link para pesquisa:** Redirecionar para `/assets?search=<valor>` se aplicável

---

## 4. Exemplos Concretos de Fingerprint

| assetClass | Campo Único | Valor | Fingerprint Resultante |
|-----------|-------------|-------|----------------------|
| BICYCLE | frameNumber | VERUN998877 | `BICYCLE:VERUN998877` |
| VEHICLE | chassisNumber | 9BWZZZ377VT004251 | `VEHICLE:9BWZZZ377VT004251` |
| FINANCIAL_BOND | isin | BRBCBHDBBS08 | `FINANCIAL_BOND:BRBCBHDBBS08` |
| QTAG_LIFE | cpf | 12345678901 | `QTAG_LIFE:12345678901` |
| GENERIC | (nenhum) | — | `null` (sem fingerprint) |

---

## 5. Regras de Normalização

O **Backend** normaliza automaticamente:
- `trim()` — remove espaços nas extremidades
- `toUpperCase()` — case-insensitive

O **Frontend** deve enviar o fingerprint com o mesmo formato para consistência:
- `${assetClass}:${value.trim().toUpperCase()}`

---

## 6. Checklist de Implementação (Frontend)

- [ ] Adicionar `isUniqueKey` ao type `FieldSchema`
- [ ] Actualizar `registry.json` com a flag nos campos apropriados
- [ ] Implementar `buildFingerprint()` no `DynamicAssetForm`
- [ ] Enviar `fingerprint` no body do `POST /api/v1/assets`
- [ ] Tratar resposta `409 Conflict` com mensagem amigável
- [ ] Marcar campo com erro visual quando 409
- [ ] Testar: enviar mesmo serial 2× → segundo deve dar 409
- [ ] Testar: enviar sem serial (ativo genérico) → deve funcionar normalmente
