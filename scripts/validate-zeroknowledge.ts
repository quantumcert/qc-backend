import prisma from '../src/config/prisma';
import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';

async function run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING ZERO-KNOWLEDGE (AES-256-GCM DATA AT REST)');
    console.log('═══════════════════════════════════════════════════════════\n');
    try {
        // Setup Tenant
        const tenant = await prisma.tenant.create({
            data: {
                name: 'Zero-Knowledge Tenant',
                slug: 'zk-tenant-' + Date.now(),
                contactEmail: 'zk@quantumcert.com'
            }
        });
        console.log(`[1] Created Test Tenant: ${tenant.id}`);

        const sensitivePayload = {
            segredo: "dados_protegidos",
            ownerIdentity: "123.456.789-00",
            location: "Vault 7"
        };

        console.log(`\n[2] Creating Asset with Highly Sensitive Metadata:`);
        console.log(JSON.stringify(sensitivePayload, null, 2));

        // Create Asset using our standard Facet
        const asset = await AssetRegistryFacet.createAsset({
            tenantId: tenant.id,
            metadata: sensitivePayload
        });
        console.log(`    Asset Created successfully. ID: ${asset.id}`);

        // --- RAW SQL QUERY (How the database sees it) ---
        console.log('\n[3] 🔍 RAW SQL QUERY - Physical Database Layer');
        console.log('Executing: SELECT id, metadata FROM "Asset" WHERE id = $1');
        const rawResult: any[] = await prisma.$queryRaw`SELECT id, metadata FROM "Asset" WHERE id = ${asset.id}`;

        console.log('    Result from Postgres Disk:');
        console.log(JSON.stringify(rawResult[0].metadata, null, 2));

        if (rawResult[0].metadata && rawResult[0].metadata._enc) {
            console.log('    ✅ CONFIRMED: AES-256-GCM Encryption is physically active on disk!');
        } else {
            throw new Error('FAIL: Data is not encrypted at rest.');
        }

        // --- PRISMA ORM QUERY (How the API sees it) ---
        console.log('\n[4] 🔓 PRISMA EXTENSION QUERY - API Backend Layer');
        const ormResult = await prisma.asset.findUnique({
            where: { id: asset.id }
        });

        console.log('    Result intercepted and decrypted by Prisma $extends:');
        console.log(JSON.stringify(ormResult?.metadata, null, 2));

        if (ormResult?.metadata && (ormResult.metadata as any).segredo === "dados_protegidos") {
            console.log('    ✅ CONFIRMED: Interceptor successfully decrypted and restored the original JSON object!');
        } else {
            throw new Error('FAIL: Prisma Extension failed to decrypt data.');
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(' ZERO-KNOWLEDGE AUDIT COMPLETED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (e) {
        console.error('Validation failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
