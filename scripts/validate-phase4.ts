import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';
import { EventLogFacet } from '../src/services/core-facets/EventLogFacet';
import { ContextRouterFacet } from '../src/services/core-facets/ContextRouterFacet';
import prisma from '../src/config/prisma';

async function run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING PHASE 4: EVENT LOG & QUARANTINE ENGINE');
    console.log('═══════════════════════════════════════════════════════════\n');
    try {
        // Setup Tenant
        const tenant = await prisma.tenant.create({
            data: {
                name: 'Test Tenant Phase 4',
                slug: 'test-phase-4-' + Date.now(),
                contactEmail: 'contact@phase4.com'
            }
        });
        console.log(`[1] Created Test Tenant: ${tenant.id}`);

        // Create an Asset for the Event flow
        const asset = await AssetRegistryFacet.createAsset({
            tenantId: tenant.id,
            metadata: { name: "Quantum Asset for Events" },
            publicDataKeys: ['name']
        });
        console.log(`[2] Created Asset: ${asset.id}`);

        // FLUXO A: Escrita Direta (Auditor)
        console.log('\n[3] FLUXO A: Writing Authenticated Event (Auditor)...');
        const authEvent = await EventLogFacet.recordAuthenticatedEvent({
            assetId: asset.id,
            tenantId: tenant.id,
            origin: "ApiKey_Audit123",
            payload: { message: "Certification Renewed", validUntil: "2030" }
        });
        console.log(`    Created Event ID: ${authEvent.id} | Status: ${authEvent.status}`);

        // FLUXO B: Quarentena e Aprovação (Público)
        console.log('\n[4] FLUXO B: Pushing Public Event (Quarantine)...');
        const publicEvent = await EventLogFacet.suggestPublicEvent({
            assetId: asset.id,
            payload: { message: "Ownership Transfer Request", newOwner: "Alice" }
        });
        console.log(`    Created Event ID: ${publicEvent.id} | Status: ${publicEvent.status}`);

        // Verificando Roteador com Status Atual
        console.log('\n[5] Checking ContextRouter before Review...');
        let readStatus = await ContextRouterFacet.routeAssetRead(asset.id, { isAuthenticated: true, tenantId: tenant.id });
        console.log(`    Events counted in Asset: ${readStatus?.asset.events?.length}`); // Should be 1 (only the APPROVED one)

        // Revisão de Evento Quarentenado (Aprovação)
        console.log('\n[6] Reviewing Event: APPROVING Public Event...');
        await EventLogFacet.reviewEvent(publicEvent.id, tenant.id, 'APPROVED');

        // Verificando Roteador após Revisão
        console.log('\n[7] Checking ContextRouter AFTER Review...');
        readStatus = await ContextRouterFacet.routeAssetRead(asset.id, { isAuthenticated: false });
        console.log(`    Events counted in Public Asset: ${readStatus?.asset.events?.length}`); // Should be 2 (both now APPROVED)

        const events = readStatus?.asset.events || [];
        if (events.length === 2 && events.every((e: any) => e.status === 'APPROVED')) {
            console.log('    ✅ SUCCESS: The Event Quarantine Engine and ContextRouter are working perfectly.');
        } else {
            throw new Error("FAIL: Events state is inconsistent with the expected outcome.");
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(' PHASE 4 COMPLETED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (e) {
        console.error('Validation failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
