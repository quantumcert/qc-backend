import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';
import { EventLogFacet } from '../src/services/core-facets/EventLogFacet';
import { MockDLTAdapterFacet } from '../src/services/core-facets/MockDLTAdapterFacet';
import { AnchorQueueService } from '../src/services/AnchorQueueService';
import prisma from '../src/config/prisma';

async function run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING PHASE 6: DLT ABSTRACTION (ANCHOR QUEUE)');
    console.log('═══════════════════════════════════════════════════════════\n');
    try {
        // Setup Tenant
        const tenant = await prisma.tenant.create({
            data: {
                name: 'Test Tenant Phase 6',
                slug: 'test-phase-6-' + Date.now(),
                contactEmail: 'contact@phase6.com'
            }
        });
        console.log(`[1] Created Test Tenant: ${tenant.id}`);

        // Create an Asset
        const asset = await AssetRegistryFacet.createAsset({
            tenantId: tenant.id,
            metadata: { type: "Luxury Goods" },
        });
        console.log(`[2] Created Asset: ${asset.id}`);

        // Criar Evento APPROVED
        console.log('\n[3] FLUXO A: Writing Authenticated Event (APPROVED)...');
        const authEvent = await EventLogFacet.recordAuthenticatedEvent({
            assetId: asset.id,
            tenantId: tenant.id,
            origin: "ApiKey_Backend",
            payload: { action: "Certification", description: "Authenticity Confirmed." }
        });
        console.log(`    Created Event ID: ${authEvent.id} | Hash: ${authEvent.signatureHash}`);

        // Verificar fila
        console.log('\n[4] Init Anchor Queue Service (with Mock DLT)...');
        const dltMock = new MockDLTAdapterFacet();
        const queueService = new AnchorQueueService(dltMock);

        console.log('\n[5] Processing DLT Anchor Queue...');
        const queueResult = await queueService.processQueue();
        console.log(`    Processed ${queueResult.processed} items.`);

        // Verificar banco para checar o txId
        console.log('\n[6] Checking Database for DLT TxID...');
        const anchoredEvent = await prisma.eventLog.findUnique({ where: { id: authEvent.id } });

        console.log(`    Signature Hash: ${anchoredEvent?.signatureHash}`);
        console.log(`    DLT TxID: ${anchoredEvent?.dltTxId}`);

        if (anchoredEvent && anchoredEvent.signatureHash && anchoredEvent.dltTxId) {
            console.log('\n    ✅ SUCCESS: Signature Hash and DLT Transaction ID properly stored!');
        } else {
            throw new Error("FAIL: TxID or Signature Hash is missing in database.");
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(' PHASE 6 COMPLETED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (e) {
        console.error('Validation failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
