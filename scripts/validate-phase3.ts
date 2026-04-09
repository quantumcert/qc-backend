import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';
import { ContextRouterFacet } from '../src/services/core-facets/ContextRouterFacet';
import prisma from '../src/config/prisma';

async function run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING PHASE 3: CONTEXT ROUTER & RBAC');
    console.log('═══════════════════════════════════════════════════════════\n');
    try {
        // Setup Tenant
        const tenant = await prisma.tenant.create({
            data: {
                name: 'Test Tenant Phase 3',
                slug: 'test-phase-3-' + Date.now(),
                contactEmail: 'contact@phase3.com'
            }
        });
        console.log(`[1] Created Test Tenant: ${tenant.id}`);

        // Define Metadata
        const fullMetadata = {
            secretData: "This is super secret (Internal ROI)",
            productName: "Quantum Rolex Explorer",
            serial: "123-SECRET",
            publicDescription: "A fine watch."
        };

        // Create Asset mapped to that tenant, specifying strictly public keys
        console.log('\n[2] Generating Asset with Public Profile settings...');
        const asset = await AssetRegistryFacet.createAsset({
            tenantId: tenant.id,
            metadata: fullMetadata,
            publicDataKeys: ['productName', 'publicDescription']
        });

        console.log(`    Asset ID: ${asset.id}`);
        console.log(`    Automatic Public URL: ${asset.publicUrl}`);

        if (!asset.publicUrl) throw new Error("Public URL generation failed");

        // Simulating Case B: Public Request (No API Key)
        console.log('\n[3] Simulating Public API Read (Case B)...');
        const publicRead = await ContextRouterFacet.routeAssetRead(asset.id, { isAuthenticated: false });
        console.log(`    Result Context: ${publicRead?.context}`);
        console.log('    Public Metadata Payload:', publicRead?.asset.metadata);

        // Simulating Case A: Authenticated Request (With API Key mapped to Tenant)
        console.log('\n[4] Simulating Authenticated API Read (Case A)...');
        const authRead = await ContextRouterFacet.routeAssetRead(asset.id, { isAuthenticated: true, tenantId: tenant.id });
        console.log(`    Result Context: ${authRead?.context}`);
        console.log('    Authenticated Metadata Payload:', authRead?.asset.metadata);

        // ASSERTIONS
        console.log('\n[5] Running Privacy Assertions...');
        if ('secretData' in publicRead!.asset.metadata) {
            throw new Error("FAIL: Secret data leaked in public read!");
        } else {
            console.log('    ✅ SUCCESS: Secret data is successfully hidden from public read.');
        }

        if ('secretData' in authRead!.asset.metadata) {
            console.log('    ✅ SUCCESS: Secret data is correctly preserved in authenticated read.');
        } else {
            throw new Error("FAIL: Secret data missing in authenticated read!");
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(' PHASE 3 COMPLETED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (e) {
        console.error('Validation failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
