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
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { ApiKeyManagementFacet } from '../services/core-facets/ApiKeyManagementFacet';

const prisma = new PrismaClient();

async function main() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  QUANTUM CERT — BOOTSTRAP SEED');
    console.log('  Creating Platform Tenant & Admin API Key');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // ─── Step 1: Create Platform Tenant ───────────────────
    const platformSlug = 'quantum-cert-platform';

    let platformTenant = await prisma.tenant.findUnique({
        where: { slug: platformSlug },
    });

    if (platformTenant) {
console.log(`  Platform Tenant already exists: ${platformTenant.id}`);
    } else {
        platformTenant = await prisma.tenant.create({
            data: {
                name: 'Quantum Cert Platform',
                slug: platformSlug,
                contactEmail: 'admin@quantumcert.io',
                planTier: 'ENTERPRISE',
                isActive: true,
            },
        });
console.log(`  Platform Tenant created: ${platformTenant.id}`);

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
                },
            },
        });
    }

    // ─── Step 2: Create Admin API Key ─────────────────────
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

    // ─── Step 3: Create a Sample FREE Tenant ──────────────
    const sampleSlug = 'sample-tenant';
    let sampleTenant = await prisma.tenant.findUnique({
        where: { slug: sampleSlug },
    });

    if (sampleTenant) {
        console.log(`  ✅ Sample Tenant already exists: ${sampleTenant.id}`);
    } else {
        sampleTenant = await prisma.tenant.create({
            data: {
                name: 'Sample Tenant',
                slug: sampleSlug,
                contactEmail: 'sample@example.com',
                planTier: 'FREE',
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

main()
    .catch((error) => {
        console.error('  ❌ Bootstrap failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
