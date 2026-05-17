export const DEFAULT_PLATFORM_TENANT_SLUG = 'quantum-cert-platform';
export const DEFAULT_PLATFORM_TENANT_NAME = 'Quantum Cert';
export const DEFAULT_PLATFORM_TENANT_CONTACT_EMAIL = 'platform@quantumcert.com';
export const PREVIOUS_PLATFORM_TENANT_SLUG = 'quantum';

// The platform tenant identity is intentionally not configurable by env.
// It is the root tenant for Quantum Cert operations and must be stable across
// seeds, local dev, staging and production.
export function getPlatformTenantSlug() {
    return DEFAULT_PLATFORM_TENANT_SLUG;
}

export function getPlatformTenantName() {
    return DEFAULT_PLATFORM_TENANT_NAME;
}

export function getPlatformTenantContactEmail() {
    return DEFAULT_PLATFORM_TENANT_CONTACT_EMAIL;
}
