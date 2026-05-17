export const DEFAULT_PLATFORM_TENANT_SLUG = 'quantum-cert-platform';
export const DEFAULT_PLATFORM_TENANT_NAME = 'Quantum Cert';
export const DEFAULT_PLATFORM_TENANT_CONTACT_EMAIL = 'platform@quantumcert.com';
export const PREVIOUS_PLATFORM_TENANT_SLUG = 'quantum';

export function getPlatformTenantSlug() {
    return process.env.QUANTUM_TENANT_SLUG || DEFAULT_PLATFORM_TENANT_SLUG;
}

export function getPlatformTenantName() {
    return process.env.QUANTUM_TENANT_NAME || DEFAULT_PLATFORM_TENANT_NAME;
}

export function getPlatformTenantContactEmail() {
    return process.env.QUANTUM_TENANT_CONTACT_EMAIL || DEFAULT_PLATFORM_TENANT_CONTACT_EMAIL;
}
