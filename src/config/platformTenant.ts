export const PLATFORM_TENANT_IDENTITY = Object.freeze({
    slug: 'quantum-cert-platform',
    name: 'Quantum Cert',
    contactEmail: 'platform@quantumcert.com',
});

export const DEFAULT_PLATFORM_TENANT_SLUG = PLATFORM_TENANT_IDENTITY.slug;
export const DEFAULT_PLATFORM_TENANT_NAME = PLATFORM_TENANT_IDENTITY.name;
export const DEFAULT_PLATFORM_TENANT_CONTACT_EMAIL = PLATFORM_TENANT_IDENTITY.contactEmail;
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
