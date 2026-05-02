# QTAG Record Module — Integration Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atualizar o `qc-record-module` para integrar corretamente com os endpoints do `qc-backend` QTAG sub-system, adicionando autenticação via API Key e corrigindo o contrato de API.

**Architecture:** O `qc-record-module` (Python edge) atualmente chama `GET /api/production-queue` e `POST /api/tag-provisioned` — endpoints que não existem no qc-backend. O qc-backend expõe `POST /api/v1/diamond` com seletores `commissioning.start` e `commissioning.confirm`, protegidos por `X-API-Key` e `X-Idempotency-Key`. A mudança é apenas no `orchestrator.py` e `.env.example` do qc-record-module.

**Tech Stack:** Python 3.11+, aiohttp, FastAPI (qc-record-module) | Node.js/TypeScript, Prisma (qc-backend)

---

## Contexto do Gap

| Chamada atual (ERRADA) | Endpoint correto no qc-backend |
|---|---|
| `GET /api/production-queue?uid=<UID>` | `POST /api/v1/diamond` + `{ selector: "commissioning.start", payload: { assetId, ntagUID, metadata } }` |
| `POST /api/tag-provisioned` | `POST /api/v1/diamond` + `{ selector: "commissioning.confirm", payload: { sessionId, success, bytesWritten, ntagUID } }` |
| (sem header de auth) | `X-API-Key: <qc_...>` obrigatório |
| (sem idempotency key) | `X-Idempotency-Key: <uuid>` obrigatório em mutations |

---

## Mapa de Arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src_python/orchestrator.py` | Modificar | Substituir chamadas de API por Diamond calls com auth |
| `.env.example` | Modificar | Adicionar `STATION_API_KEY` e `ASSET_ID` |
| `src_python/main.py` | Modificar | Carregar `STATION_API_KEY` do env |

---

## Task 1: Adicionar variáveis de ambiente no qc-record-module

**Files:**
- Modify: `.env.example`
- Modify: `src_python/orchestrator.py:1-25`

- [ ] **Step 1: Atualizar `.env.example`**

Substituir o conteúdo das variáveis de backend para:

```env
BACKEND_URL=https://api.quantumcert.com.br
STATION_API_KEY=qc_your_operator_key_here
STATION_ID=ESTACAO-01
ACTIVATION_BASE_URL=https://quantumcert.com.br/activate
PUBLIC_URL_BASE=https://quantumcert.com.br/v/
AUTH_TIMEOUT_SECONDS=120
OUTPUT_DIR=./outputs
```

- [ ] **Step 2: Atualizar constantes em `orchestrator.py`**

Substituir o bloco de constantes (linhas 18-20):

```python
BACKEND_BASE_URL = os.getenv('BACKEND_URL', 'http://localhost:8000')
DIAMOND_ENDPOINT  = f'{BACKEND_BASE_URL}/api/v1/diamond'
STATION_API_KEY   = os.getenv('STATION_API_KEY', '')

def _auth_headers(idempotency_key: str | None = None) -> dict:
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': STATION_API_KEY,
    }
    if idempotency_key:
        headers['X-Idempotency-Key'] = idempotency_key
    return headers
```

- [ ] **Step 3: Commit**

```bash
git add .env.example src_python/orchestrator.py
git commit -m "feat: add STATION_API_KEY and Diamond endpoint constants"
```

---

## Task 2: Substituir `fetch_production_queue` por `commissioning_start`

**Files:**
- Modify: `src_python/orchestrator.py` (função `fetch_production_queue`, aprox. linhas 28-38)

- [ ] **Step 1: Substituir a função**

Remover `fetch_production_queue` e adicionar `commissioning_start`:

```python
async def commissioning_start(uid: str, asset_id: str, metadata: dict) -> dict | None:
    """Calls commissioning.start on qc-backend Diamond. Returns { sessionId, layout, pages, sdmMacKey, writeKey }."""
    idempotency_key = str(uuid.uuid4())
    body = {
        'selector': 'commissioning.start',
        'payload': {
            'assetId': asset_id,
            'ntagUID': uid,
            'metadata': metadata,
        },
    }
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.post(
                DIAMOND_ENDPOINT,
                json=body,
                headers=_auth_headers(idempotency_key),
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                text = await resp.text()
                print(f'[WARN] commissioning.start HTTP {resp.status}: {text}')
                return None
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        print(f'[WARN] commissioning.start offline: {e}')
        return None
```

- [ ] **Step 2: Verificar que `uuid` está importado no topo do arquivo**

O módulo `uuid` já é importado (linha 113 usa `uuid.uuid4()`). Se não estiver no topo, adicionar:

```python
import uuid
```

- [ ] **Step 3: Commit**

```bash
git add src_python/orchestrator.py
git commit -m "feat: replace fetch_production_queue with commissioning_start Diamond call"
```

---

## Task 3: Substituir `report_tag_provisioned` por `commissioning_confirm`

**Files:**
- Modify: `src_python/orchestrator.py` (função `report_tag_provisioned`, aprox. linhas 43-55)

- [ ] **Step 1: Substituir a função**

Remover `report_tag_provisioned` e adicionar `commissioning_confirm`:

```python
async def commissioning_confirm(session_id: str, uid: str, bytes_written: int, success: bool) -> bool:
    """Calls commissioning.confirm on qc-backend Diamond. Returns True on success."""
    idempotency_key = f'confirm-{session_id}'
    body = {
        'selector': 'commissioning.confirm',
        'payload': {
            'sessionId': session_id,
            'success': success,
            'bytesWritten': bytes_written,
            'ntagUID': uid,
        },
    }
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.post(
                DIAMOND_ENDPOINT,
                json=body,
                headers=_auth_headers(idempotency_key),
            ) as resp:
                if resp.status == 200:
                    return True
                text = await resp.text()
                print(f'[WARN] commissioning.confirm HTTP {resp.status}: {text}')
                return False
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        print(f'[WARN] commissioning.confirm offline: {e}')
        return False
```

- [ ] **Step 2: Commit**

```bash
git add src_python/orchestrator.py
git commit -m "feat: replace report_tag_provisioned with commissioning_confirm Diamond call"
```

---

## Task 4: Atualizar o loop principal para usar as novas funções

**Files:**
- Modify: `src_python/orchestrator.py` (função `run_nfc_edge_loop`, aprox. linhas 60-250)

O loop principal usa `fetch_production_queue` e `report_tag_provisioned`. Precisa ser atualizado para:
1. Chamar `commissioning_start` com `uid`, `asset_id` e `metadata` básicos
2. Guardar o `sessionId` retornado
3. Usar o `sessionId` em `commissioning_confirm` ao final

- [ ] **Step 1: Localizar as chamadas antigas no loop e substituir**

Encontrar onde `fetch_production_queue(uid)` é chamado e substituir por:

```python
# Defina asset_id e metadata antes (pode vir de env var ou config local)
asset_id = os.getenv('ASSET_ID', f'ASSET-{uid.upper()}')
metadata = {'provisioned_by': STATION_ID, 'uid': uid}

commission_data = await commissioning_start(uid, asset_id, metadata)
if commission_data is None:
    # Backend offline — usar fallback local para URL base
    session_id = None
    layout_pages = None
else:
    session_id = commission_data.get('sessionId')
    layout_pages = commission_data.get('pages')  # 36 pages base64
    sdm_mac_key = commission_data.get('sdmMacKey')
    write_key = commission_data.get('writeKey')
```

- [ ] **Step 2: Substituir a chamada `report_tag_provisioned` no loop**

Encontrar onde `report_tag_provisioned` é chamado e substituir por:

```python
if session_id:
    await commissioning_confirm(
        session_id=session_id,
        uid=uid,
        bytes_written=144,
        success=True,
    )
```

- [ ] **Step 3: Adicionar `ASSET_ID` no `.env.example`**

```env
ASSET_ID=CERT-2026-00001
```

- [ ] **Step 4: Commit**

```bash
git add src_python/orchestrator.py .env.example
git commit -m "feat: wire NFC loop to commissioning_start/confirm Diamond calls"
```

---

## Task 5: Validação manual (smoke test)

Não há testes automatizados no qc-record-module. Validação é manual via dashboard.

- [ ] **Step 1: Criar API key de teste no qc-backend**

```bash
# No qc-backend
npm run seed:bootstrap
# Copiar a API key gerada (começa com qc_)
```

- [ ] **Step 2: Configurar `.env` no qc-record-module**

```env
BACKEND_URL=http://localhost:3000   # qc-backend local
STATION_API_KEY=qc_<key_gerada>
STATION_ID=ESTACAO-TEST
ASSET_ID=CERT-TEST-001
```

- [ ] **Step 3: Subir qc-backend e qc-record-module**

```bash
# Terminal 1 (qc-backend)
cd /Volumes/External\ SSD/Projects/qc-backend && npm run dev

# Terminal 2 (qc-record-module)
cd /Volumes/External\ SSD/Projects/qc-record-module && python src_python/main.py
```

- [ ] **Step 4: Verificar no log do qc-backend**

Ao detectar tag NFC, o qc-backend deve logar:
- `POST /api/v1/diamond commissioning.start 200`
- `POST /api/v1/diamond commissioning.confirm 200`

- [ ] **Step 5: Commit final**

```bash
git add .
git commit -m "docs: update .env.example with correct qc-backend integration vars"
```

---

## Self-Review

**Cobertura da spec:**
- ✅ URL contract corrigido: `/api/production-queue` → `POST /api/v1/diamond` com `commissioning.start`
- ✅ URL contract corrigido: `/api/tag-provisioned` → `POST /api/v1/diamond` com `commissioning.confirm`
- ✅ `X-API-Key` adicionado via `STATION_API_KEY` env var
- ✅ `X-Idempotency-Key` adicionado em ambas as chamadas
- ✅ `sessionId` retornado pelo `commissioning.start` é passado para `commissioning.confirm`
- ✅ Fallback local mantido quando backend offline

**Fora de escopo deste plano:**
- Testes automatizados no qc-record-module (projeto Python sem test suite)
- QID authorization flow (Falcon-512 + biometria) — depende do qc-tag-emulator SDK
- `layout_pages` e `writeKey` recebidos de `commissioning.start` — usados nas etapas 7-9 APDU que o qc-record-module já implementa via `ev2_crypto.py`
