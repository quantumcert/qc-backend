import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';
import { BlindContactLogFacet } from '../src/services/core-facets/BlindContactLogFacet';
import { ContextRouterFacet } from '../src/services/core-facets/ContextRouterFacet';
import prisma from '../src/config/prisma';

async function run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING PHASE 5: ASSET STATUS & DOUBLE-BLIND QUARANTINE');
    console.log('═══════════════════════════════════════════════════════════\n');
    try {
        // Setup Tenant
        const tenant = await prisma.tenant.create({
            data: {
                name: 'Test Tenant Phase 5',
                slug: 'test-phase-5-' + Date.now(),
                contactEmail: 'contact@phase5.com'
            }
        });
        console.log(`[1] Created Test Tenant: ${tenant.id}`);

        // Create an Asset with explicit ACTIVE status
        const asset = await AssetRegistryFacet.createAsset({
            tenantId: tenant.id,
            metadata: { description: "Valuable Equipment" },
            publicDataKeys: ['description'],
            status: 'ACTIVE'
        });
        console.log(`[2] Created Asset: ${asset.id} | Status: ${asset.status}`);

        // Tentativa de contato em Ativo ACTIVE (Deve falhar)
        console.log('\n[3] Attempting Finder Contact on ACTIVE Asset...');
        try {
            await BlindContactLogFacet.submitContact(asset.id, { name: "Bob", phone: "555-0199", notes: "I found this." }, "192.168.0.10");
            throw new Error("FAIL: System allowed contact on an ACTIVE asset.");
        } catch (error: any) {
            if (error.message === "ASSET_NOT_IN_ALERT") {
                console.log('    ✅ SUCCESS: Contact submission rejected (ASSET_NOT_IN_ALERT).');
            } else {
                throw error;
            }
        }

        // Alterando status do Asset para ALERT (e.g. dono reportou perda)
        console.log('\n[4] Owner updates Asset Status to ALERT...');
        const updatedAsset = await AssetRegistryFacet.updateAsset(asset.id, tenant.id, { status: 'ALERT' });
        console.log(`    Asset Status updated to: ${updatedAsset.status}`);

        // Verificando Roteador com Status ALERT para o perfil Público
        console.log('\n[5] Checking PublicProfile for Alert Flags...');
        const publicRead = await ContextRouterFacet.routeAssetRead(asset.id, { isAuthenticated: false });
        // Aqui temos que observar se o campo "isAlert" está vindo conforme especificado
        console.log(`    isAlert Flag on Public Read: ${publicRead?.asset.isAlert}`);
        if (publicRead?.asset.isAlert !== true) {
            throw new Error("FAIL: Public profile did not expose the ALERT condition.");
        } else {
            console.log('    ✅ SUCCESS: Public profile correctly indicates the ALERT state.');
        }

        // Tentativa de contato em Ativo ALERT (Deve passar)
        console.log('\n[6] Attempting Finder Contact on ALERT Asset (Double-Blind Quarantine)...');
        const blindContact = await BlindContactLogFacet.submitContact(
            asset.id,
            { name: "Bob", phone: "555-0199", notes: "I found this equipment near the park." },
            "192.168.0.10"
        );
        console.log(`    Contact Form Submitted Successfully! LogID: ${blindContact.id}`);

        // Verificando banco Isolado
        const savedLog = await prisma.blindContactLog.findUnique({ where: { id: blindContact.id } });
        if (savedLog && savedLog.contactData) {
            console.log('    ✅ SUCCESS: Double-Blind logic successfully quarantined the Contact payload.');
        } else {
            throw new Error("FAIL: Blind contact log was not saved to DB.");
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(' PHASE 5 COMPLETED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (e) {
        console.error('Validation failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
