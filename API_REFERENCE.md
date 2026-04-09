# Quantum Cert — API Reference (Core Agnostic Engine)

This document provides a developer overview of the Quantum Cert backend architecture and its core agnostic features. Built primarily on Node.js using an adapted version of the Diamond Pattern (EIP-2535 Protocol), the platform effectively manages modular feature expansion while preserving a unified routing and state container logic.

## 1. Architecture: Single-Endpoint Diamond Pattern (EIP-2535 Inspired)

In contrast to conventional RESTful API routing, this system funnels core atomic operations through a single dynamic entrypoint (Diamond Proxy). The method to trigger functions uses a **selector** mapped to a corresponding internal piece of logic (Facet).

### Request Structure
All calls to the structural engine are sent as **POST** requests to the Diamond proxy endpoint:

```http
POST /api/v1/diamond
```

**Payload Schema:**
```json
{
    "selector": "facetName.methodName",
    "payload": {
       // Function-specific arguments
    }
}
```

## 2. Authentication

Requests require robust origin verification. The backend employs an API gateway strategy with API keys to resolve operations automatically mapped to specific Tenants.

### Required Header:

```http
x-api-key: qc_key_ab123...
```
*(The system automatically enforces Role-Based Access Control and Tenant Isolation downstream based on the validity and metadata connected to the API Key provided.)*

## 3. Core Payload Contracts

### 3.1. Asset Minting (`asset.create`)
Creates a new universal, agnostic asset container bounded to the Tenant owning the API Key.

**Selector:** `asset.create`

**Request Payload:**
```json
{
    "externalId": "EXT-001",
    "deviceId": "OPTIONAL_NFC_UID",
    "metadata": { 
        "brand": "Brand",
        "description": "Any arbitrary JSON metadata"
    },
    "publicDataKeys": ["brand", "description"],
    "owners": [
        { "ownerRef": "client_email@example.com", "label": "Main Owner", "sharePercent": 100 }
    ]
}
```

**Response Payload:**
```json
{
    "id": "asset_uuid",
    "status": "ACTIVE",
    "publicUrl": "https://api.domain.com/v1/public/asset/asset_uuid",
    "metadata": { ... }
}
```

### 3.2. State Transition (`asset.update`)
Modifies non-terminal state configurations for a specified asset. Requires `ADMIN` roles. Terminal states (like `BURNED`) are irreversible.

**Selector:** `asset.update`

**Request Payload:**
```json
{
    "id": "asset_uuid",
    "status": "RETIRED",
    "metadata": { 
        "updatedKey": "New Value" 
    }
}
```

**Response Payload:**
```json
{
    "id": "asset_uuid",
    "status": "RETIRED"
}
```

### 3.3. Transfer Request (`transfer.initiate`)
Initializes the ownership transfer protocol, dynamically resolving fees based on the Tenant's pricing architecture and creating a shadow account for the pending buyer.

**Selector:** `transfer.initiate`

**Request Payload:**
```json
{
    "assetId": "asset_uuid",
    "buyerEmail": "new_owner_reference_or_email@example.com"
}
```

**Response Payload:**
```json
{
    "success": true,
    "status": "AWAITING_PAYMENT",
    "paymentLink": "https://billing-gateway-link...",
    "buyerAddress": "new_owner_reference_or_email@example.com"
}
```

### 3.4. Event Injection (`event.record`)
Allows automated orchestration systems or verified third-party integrations to anchor unchangeable events chronologically over an arbitrary asset's lifetime.

**Selector:** `event.record`

**Request Payload:**
```json
{
    "assetId": "asset_uuid",
    "origin": "MAINTENANCE_API_KEY",
    "payload": {
        "action": "MAINTENANCE",
        "notes": "Annual inspection passed."
    }
}
```

**Response Payload:**
```json
{
    "id": "event_uuid",
    "status": "APPROVED",
    "signatureHash": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb..."
}
```

---

## 4. Zero-Knowledge Queries / Blind Validators (LGPD)

The platform adopts strong compliance paradigms around personal data minimization (e.g., Brazilian LGPD, GDPR). Unauthenticated endpoints ensure validability operations are fully processed without accidentally revealing owners or hidden metadata.

### 4.1. Public Lookup (`profile.lookup`)
Filters system assets, presenting strictly fields classified as public upon inception without outputting Tenant, user mappings, or full private records.

**Endpoint:** `GET /api/v1/public/asset/:id`

**Response Example (Masked):**
```json
{
    "id": "asset_uuid",
    "externalId": "EXT-001",
    "metadata": { 
        "brand": "Brand",
        "description": "Any arbitrary JSON metadata" 
    },
    "isFractionable": false,
    "isAlert": false
}
```

### 4.2. Blind Relay (Anonymous Alerts / 'Achados e Perdidos')
Routes an urgent contact (e.g., "I found your item") without exposing who owns it. It records a `SYSTEM_RELAY` internally to propagate notifications safely without establishing a direct link.

**Endpoint:** `POST /api/v1/public/asset/:id/contact`

**Payload:**
```json
{
    "message": "It was found downtown!"
}
```

**Response Payload:**
```json
{
    "id": "contact_log_uuid"
}
```

*(This documentation represents the headless engine design ruleset for Quantum Cert Phase 2. Ensure clients mapping configurations respect this strict architectural blueprint).*
