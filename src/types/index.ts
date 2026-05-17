// ═══════════════════════════════════════════════════════════
// QUANTUM CERT — DIAMOND PATTERN TYPE DEFINITIONS
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Agnostic Asset Engine & Zero Knowledge Security
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Request } from 'express';
import { ApiKeyRole, PlanTier, TapVerdict, TenantMembershipRole } from '@prisma/client';

export { ApiKeyRole, PlanTier, TapVerdict, TenantMembershipRole };

// ─── AUTHENTICATED REQUEST (API Key) ────────────────────
// Extended Request carrying resolved Tenant + API Key context.
export interface AuthenticatedRequest extends Request {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
    apiKeyScopes?: string[];
    apiKeyPrefix?: string;
    agentId?: string; // set by requireAgentSignature when request comes from a machine identity
    adminActor?: AdminActorContext;
    adminScope?: AdminScope;
    correlationId?: string;
    apiRequestAuditError?: string;
}

export type AdminScope = 'PLATFORM' | 'TENANT';

export interface AdminActorContext {
    actorUserId: string;
    actorTenantId: string;
    tenantId?: string;
    role: TenantMembershipRole;
    reason?: string;
    correlationId?: string;
}

// ─── PUBLIC REQUEST ─────────────────────────────────────
// Request from unauthenticated origin (browser, public scan).
// No tenant context — only public-facing data is returned.
export interface PublicRequest extends Request {
    isPublicOrigin: true;
}

// ─── RBAC PERMISSION MATRIX ─────────────────────────────
// Defines which roles can perform which operation categories.
// ADMIN > OPERATOR > READER (strict hierarchy)
export const RBAC_HIERARCHY: Record<ApiKeyRole, number> = {
    ADMIN: 3,
    OPERATOR: 2,
    READER: 1,
};

// Check if a role has sufficient permission level
export function hasPermission(
    userRole: ApiKeyRole,
    requiredRole: ApiKeyRole
): boolean {
    return RBAC_HIERARCHY[userRole] >= RBAC_HIERARCHY[requiredRole];
}

// ─── PLAN TIER RATE LIMITS (DEFAULTS) ───────────────────
// These are the default rate limits per plan tier.
// Tenants can override via maxRequestsPerMinute/maxRequestsPerDay.
export const PLAN_TIER_LIMITS: Record<PlanTier, {
    maxRequestsPerMinute: number;
    maxRequestsPerDay: number;
}> = {
    FREE: {
        maxRequestsPerMinute: 10,
        maxRequestsPerDay: 500,
    },
    PROFESSIONAL: {
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 10_000,
    },
    ENTERPRISE: {
        maxRequestsPerMinute: 1000,     // Effectively unlimited
        maxRequestsPerDay: 1_000_000,   // Effectively unlimited
    },
};

// ─── DIAMOND FACET REGISTRY ─────────────────────────────
// Canonical names for all Diamond Pattern Facets.
// Phase 1 implements the first 3 facets.
// Future phases add new facets without modifying existing ones.
export const DiamondFacets = {
    // Phase 1: Multi-Tenant Engine & Access Control
    TENANT_MANAGEMENT: 'TenantManagementFacet',
    API_KEY_MANAGEMENT: 'ApiKeyManagementFacet',
    RATE_LIMITER: 'RateLimiterFacet',
    ADMIN_TENANT_OPERATIONS: 'AdminTenantOperationsFacet',
    ADMIN_API_KEY_OPERATIONS: 'AdminApiKeyOperationsFacet',
    CREDIT_LEDGER: 'CreditLedgerFacet',
    RECEIVABLES_PROVIDER: 'ReceivablesProviderFacet',
    QTAG_FULFILLMENT: 'QTagFulfillmentFacet',
    TENANT_USER: 'TenantUserFacet',
    TENANT_QUANTUM_BACKFILL: 'TenantQuantumBackfillFacet',

    // Phase 2: Asset Engine & Zero-Knowledge Security
    ASSET_REGISTRY: 'AssetRegistryFacet',
    NFC_VALIDATION: 'NfcValidationFacet',
    DEVICE_GUARD: 'DeviceGuardFacet',

    // Phase 2+ (placeholder — not yet activated)
    // FRACTIONAL_OWNERSHIP: 'FractionalOwnershipFacet',
    // FUNGIBLE: 'FungibleFacet',

    // Phase 3: Context Router & RBAC (placeholder)
    // CONTEXT_ROUTER: 'ContextRouterFacet',
    // PUBLIC_PROFILE: 'PublicProfileFacet',

    // Phase 4: Events & Quarantine (placeholder)
    // EVENT_LOG: 'EventLogFacet',

    // Phase 5: Status & Double-Blind (placeholder)
    // STATUS_MANAGEMENT: 'StatusManagementFacet',
    // DOUBLE_BLIND: 'DoubleBlindFacet',

    // Phase 6: DLT Abstraction (placeholder)
    // DLT_ADAPTER: 'IDLTAdapter',
    // ALGORAND_ADAPTER: 'AlgorandAdapterFacet',
    // PRIVATE_DLT_ADAPTER: 'PrivateDLTAdapterFacet',
} as const;

// ─── API RESPONSE ENVELOPE ──────────────────────────────
// Standardized API response format for all endpoints.
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    meta?: {
        timestamp: string;
        facet: string;
        requestId?: string;
    };
}

// ─── AUDIT ACTION TYPES ─────────────────────────────────
export const AuditActions = {
    // Phase 1: Tenant & API Key
    TENANT_CREATED: 'TENANT_CREATED',
    TENANT_UPDATED: 'TENANT_UPDATED',
    TENANT_DEACTIVATED: 'TENANT_DEACTIVATED',
    TENANT_REACTIVATED: 'TENANT_REACTIVATED',
    APIKEY_GENERATED: 'APIKEY_GENERATED',
    APIKEY_REVOKED: 'APIKEY_REVOKED',
    APIKEY_ROTATED: 'APIKEY_ROTATED',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

    // Phase 2: Asset & Device
    ASSET_CREATED: 'ASSET_CREATED',
    ASSET_UPDATED: 'ASSET_UPDATED',
    ASSET_DELETED: 'ASSET_DELETED',
    OWNER_ADDED: 'OWNER_ADDED',
    OWNER_REMOVED: 'OWNER_REMOVED',
    DEVICE_REGISTERED: 'DEVICE_REGISTERED',
    DEVICE_DEACTIVATED: 'DEVICE_DEACTIVATED',
    DEVICE_REACTIVATED: 'DEVICE_REACTIVATED',
    NFC_TAP_VALID: 'NFC_TAP_VALID',
    NFC_TAP_REPLAY_BLOCKED: 'NFC_TAP_REPLAY_BLOCKED',
    NFC_TAP_CMAC_INVALID: 'NFC_TAP_CMAC_INVALID',

    // M2M / Agent Registry
    AGENT_REGISTERED: 'AGENT_REGISTERED',
    AGENT_REVOKED: 'AGENT_REVOKED',
} as const;

export const ResourceTypes = {
    TENANT: 'Tenant',
    API_KEY: 'ApiKey',
    RATE_LIMIT: 'RateLimitCounter',
    CREDIT_LEDGER_ENTRY: 'CreditLedgerEntry',
    PURCHASE_ORDER: 'PurchaseOrder',
    PAYMENT_EVENT: 'PaymentEvent',
    QTAG_LEDGER_ENTRY: 'QTagLedgerEntry',
    QTAG_FULFILLMENT_ORDER: 'QTagFulfillmentOrder',
    ASSET: 'Asset',
    OWNER: 'Owner',
    DEVICE: 'Device',
    DEVICE_TAP_LOG: 'DeviceTapLog',
    AGENT: 'AGENT',
    TENANT_USER: 'TenantUser',
    TENANT_MEMBERSHIP: 'TenantMembership',
    MIGRATION_RUN: 'MigrationRun',
} as const;

// ─── PHASE 2: NFC TAP RESULT ────────────────────────────
// Return type for the NFC validation pipeline.
export interface NfcTapResult {
    verdict: TapVerdict;
    deviceId?: string;
    assetId?: string;
    counter?: number;
    message: string;
    metadata?: Record<string, unknown>;
}
