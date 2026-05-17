// ═══════════════════════════════════════════════════════════
// SEED: Bootstrap Platform Tenant & Admin API Key
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// This script creates the initial "platform" tenant and
// generates the first ADMIN API key needed to bootstrap
// all subsequent operations.
//
// Run: npx tsx src/seeds/seed-bootstrap.ts
//
// Creates and normalizes the canonical Quantum Cert platform tenant.
// The platform tenant identity is intentionally not overridable by env vars.
// ═══════════════════════════════════════════════════════════

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { ApiKeyManagementFacet } from '../services/core-facets/ApiKeyManagementFacet';
import {
    getPlatformTenantContactEmail,
    getPlatformTenantName,
    getPlatformTenantSlug,
    PREVIOUS_PLATFORM_TENANT_SLUG,
} from '../config/platformTenant';
import { DEFAULT_TENANT_TARGET_CHAIN } from '../config/tenantChains';

const prisma = new PrismaClient();

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  QUANTUM CERT — BOOTSTRAP SEED');
    console.log('  Creating Platform Tenant & Admin API Key');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // ─── Step 1: Create Canonical Quantum Cert Tenant ─────
    const platformSlug = getPlatformTenantSlug();
    const platformName = getPlatformTenantName();
    const platformContactEmail = getPlatformTenantContactEmail();

    let platformTenant = await prisma.tenant.findUnique({
        where: { slug: platformSlug },
    });

    const previousPlatformTenant = !platformTenant
        ? await prisma.tenant.findUnique({ where: { slug: PREVIOUS_PLATFORM_TENANT_SLUG } })
        : null;

    if (platformTenant) {
        platformTenant = await prisma.tenant.update({
            where: { id: platformTenant.id },
            data: {
                name: platformName,
                slug: platformSlug,
                contactEmail: platformContactEmail,
                planTier: 'ENTERPRISE',
                targetChain: DEFAULT_TENANT_TARGET_CHAIN,
                isActive: true,
                status: 'ACTIVE',
                activatedAt: platformTenant.activatedAt ?? new Date(),
                suspendedAt: null,
                archivedAt: null,
                statusReason: null,
            },
        });
        console.log(`  ✅ Quantum Cert Tenant normalized: ${platformTenant.id}`);
    } else if (previousPlatformTenant) {
        platformTenant = await prisma.tenant.update({
            where: { id: previousPlatformTenant.id },
            data: {
                name: platformName,
                slug: platformSlug,
                contactEmail: platformContactEmail,
                planTier: 'ENTERPRISE',
                targetChain: DEFAULT_TENANT_TARGET_CHAIN,
                isActive: true,
                status: 'ACTIVE',
                activatedAt: previousPlatformTenant.activatedAt ?? new Date(),
                suspendedAt: null,
                archivedAt: null,
                statusReason: null,
            },
        });
        console.log(`  ✅ Previous Platform Tenant aligned as Quantum Cert Tenant: ${platformTenant.id}`);
    } else {
        platformTenant = await prisma.tenant.create({
            data: {
                name: platformName,
                slug: platformSlug,
                contactEmail: platformContactEmail,
                planTier: 'ENTERPRISE',
                targetChain: DEFAULT_TENANT_TARGET_CHAIN,
                isActive: true,
                status: 'ACTIVE',
                activatedAt: new Date(),
            },
        });
        console.log(`  ✅ Quantum Cert Tenant created: ${platformTenant.id}`);

        // Create audit log for bootstrap
        await prisma.auditLog.create({
            data: {
                tenantId: platformTenant.id,
                action: 'TENANT_CREATED',
                resourceType: 'Tenant',
                resourceId: platformTenant.id,
                metadata: {
                    source: 'bootstrap-seed',
                    planTier: 'ENTERPRISE',
                    slug: platformSlug,
                    targetChain: DEFAULT_TENANT_TARGET_CHAIN,
                },
            },
        });
    }

    await prisma.tenantCommercialProfile.upsert({
        where: { tenantId: platformTenant.id },
        create: {
            tenantId: platformTenant.id,
            legalName: platformName,
            contactEmail: platformContactEmail,
            commercialPlan: 'PLATFORM',
            internalNotes: 'Tenant principal Quantum Cert criado pelo bootstrap canônico.',
        },
        update: {
            legalName: platformName,
            contactEmail: platformContactEmail,
            commercialPlan: 'PLATFORM',
        },
    });
    console.log(`  ✅ Quantum Cert Tenant visible in admin list: ${platformTenant.slug}`);

    // ─── Step 2: Create Canonical Platform Admin User ─────
    const platformAdminOpenId = process.env.QUANTUM_PLATFORM_ADMIN_OPEN_ID || 'dev-user-001';
    const platformAdminEmail = process.env.QUANTUM_PLATFORM_ADMIN_EMAIL || 'dev@localhost';
    const platformAdminName = process.env.QUANTUM_PLATFORM_ADMIN_NAME || 'Quantum Platform Admin';
    const platformAdminIdentities = buildPlatformAdminIdentities({
        openId: platformAdminOpenId,
        email: platformAdminEmail,
        name: platformAdminName,
    });

    for (const identity of platformAdminIdentities) {
        const platformAdminUser = await prisma.tenantUser.upsert({
            where: { legacyOpenId: identity.openId },
            create: {
                tenantId: platformTenant.id,
                legacyOpenId: identity.openId,
                email: identity.email,
                displayName: identity.name,
                role: 'PLATFORM_ADMIN',
                status: 'ACTIVE',
                metadata: {
                    source: 'bootstrap-seed',
                    localPlatformAlias: identity.openId !== platformAdminOpenId,
                },
            },
            update: {
                tenantId: platformTenant.id,
                email: identity.email,
                displayName: identity.name,
                role: 'PLATFORM_ADMIN',
                status: 'ACTIVE',
            },
        });

        await prisma.tenantMembership.upsert({
            where: {
                tenantId_userId: {
                    tenantId: platformTenant.id,
                    userId: platformAdminUser.id,
                },
            },
            create: {
                tenantId: platformTenant.id,
                userId: platformAdminUser.id,
                role: 'PLATFORM_ADMIN',
                status: 'ACTIVE',
                reason: 'bootstrap platform admin',
            },
            update: {
                role: 'PLATFORM_ADMIN',
                status: 'ACTIVE',
                reason: 'bootstrap platform admin',
            },
        });
    }
    console.log(`  ✅ Platform Admin users linked: ${platformAdminIdentities.map((item) => item.openId).join(', ')}`);

    // ─── Step 3: Create Admin API Key ─────────────────────
    // Check if there's already an active ADMIN key
    const existingAdminKey = await prisma.apiKey.findFirst({
        where: {
            tenantId: platformTenant.id,
            role: 'ADMIN',
            isActive: true,
        },
    });

    if (existingAdminKey) {
        console.log(`  ✅ Admin API Key already exists: ${existingAdminKey.keyPrefix}...`);
        console.log('');
        console.log('  ℹ️  If you need a new key, revoke the existing one first.');
    } else {
        const result = await ApiKeyManagementFacet.generateApiKey({
            tenantId: platformTenant.id,
            role: 'ADMIN',
            label: 'Platform Bootstrap Admin Key',
        });

        console.log(`  ✅ Admin API Key generated!`);
        console.log('');
        console.log('  ╔═══════════════════════════════════════════════════════╗');
        console.log('  Save this key - it will not be shown again!');
        console.log('  ╠═══════════════════════════════════════════════════════╣');
        console.log(`  ║  Key: ${result.rawKey}`);
        console.log(`  ║  Prefix: ${result.keyPrefix}`);
        console.log(`  ║  Role: ${result.role}`);
        console.log(`  ║  Tenant: ${platformTenant.name} (${platformTenant.id})`);
        console.log('  ╚═══════════════════════════════════════════════════════╝');
    }

    // ─── Step 4: Create a Sample FREE Tenant ──────────────
    const sampleSlug = 'sample-tenant';
    let sampleTenant = await prisma.tenant.findUnique({
        where: { slug: sampleSlug },
    });

    if (sampleTenant) {
        sampleTenant = await prisma.tenant.update({
            where: { id: sampleTenant.id },
            data: {
                targetChain: DEFAULT_TENANT_TARGET_CHAIN,
            },
        });
        console.log(`  ✅ Sample Tenant already exists: ${sampleTenant.id}`);
    } else {
        sampleTenant = await prisma.tenant.create({
            data: {
                name: 'Sample Tenant',
                slug: sampleSlug,
                contactEmail: 'sample@example.com',
                planTier: 'FREE',
                targetChain: DEFAULT_TENANT_TARGET_CHAIN,
                isActive: true,
            },
        });
        console.log(`  ✅ Sample FREE Tenant created: ${sampleTenant.id}`);

        // Create an OPERATOR key for the sample tenant
        const sampleKey = await ApiKeyManagementFacet.generateApiKey({
            tenantId: sampleTenant.id,
            role: 'OPERATOR',
            label: 'Sample Tenant Operator Key',
        });

        console.log(`  ✅ Sample Operator Key: ${sampleKey.rawKey}`);
        console.log(`     (This is a FREE tier tenant — rate limited)`);
    }

    console.log('');
    console.log('  ── Bootstrap Complete ──');
    console.log('');
    console.log('  Use the Admin API Key to authenticate requests:');
    console.log('     curl -H "X-API-Key: qc_test_..." http://localhost:3000/api/v1/tenants');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
}

function buildPlatformAdminIdentities(primary: { openId: string; email: string; name: string }) {
    const configuredAliases = (process.env.QUANTUM_PLATFORM_ADMIN_ALIASES || 'dev@localhost,dev@local.host')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const identities = new Map<string, { openId: string; email: string; name: string }>();

    identities.set(primary.openId, primary);

    for (const alias of configuredAliases) {
        if (!identities.has(alias)) {
            identities.set(alias, {
                openId: alias,
                email: alias.includes('@') ? alias : primary.email,
                name: primary.name,
            });
        }
    }

    return Array.from(identities.values());
}

main()
    .catch((error) => {
        console.error('  ❌ Bootstrap failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
