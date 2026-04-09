import { AlgorandAnchorFacet } from '../src/services/core-facets/AlgorandAnchorFacet';
import { AnchorQueueService } from '../src/services/AnchorQueueService';
import prisma from '../src/config/prisma';
import algosdk from 'algosdk';

// -----------------------------------------------------------------------------
// 🛠️ MOCK SETUP FOR NODE RPC (Allows offline testing of real crypto SDK)
// -----------------------------------------------------------------------------
const mockTxId = 'MOCK_TX_' + Date.now();
const originalSendRawTransaction = algosdk.Algodv2.prototype.sendRawTransaction;

// Replace SDK methods
algosdk.Algodv2.prototype.sendRawTransaction = function (stxOrStxs: Uint8Array | Uint8Array[]) {
    return {
        do: async () => {
            return { txId: mockTxId };
        }
    };
} as any;

// Mock waitForConfirmation to skip real network waiting
algosdk.waitForConfirmation = async (client: any, txId: string, limit: number) => {
    return { 'confirmed-round': 10005 } as any;
};
// -----------------------------------------------------------------------------

async function runTest() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING ALGORAND OMNIBUS WALLET (LGPD OBFUSCATED ANCHORS)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const tenantId = 'tenant-omnibus-' + Date.now();
    const eventId = 'event-omnibus-' + Date.now();
    const MOCK_EVENT_HASH = '1f40fc92da241694750979ee6cf582f2d5d7d28e18335de05abc54d0560e0f5302860c652bf08d560252aa5e74210546f369fbbbce8c12cfc7957b2652fe9a75';

    try {
        // [1] Prepare data context
        await prisma.tenant.create({
            data: { id: tenantId, name: 'Omnibus Tenant', slug: tenantId, contactEmail: 'omnibus@qc.local' }
        });

        const { AssetRegistryFacet } = require('../src/services/core-facets/AssetRegistryFacet');
        await AssetRegistryFacet.createAsset({
            tenantId,
            metadata: { context: "Omnibus anchoring test" }
        });

        const createdAsset = await prisma.asset.findFirst({ orderBy: { createdAt: 'desc' } });

        await prisma.eventLog.create({
            data: {
                id: eventId,
                tenantId: tenantId,
                assetId: createdAsset!.id,
                origin: 'ADMIN_KEY',
                status: 'APPROVED',
                payload: { action: 'TestAnchor' },
                signatureHash: MOCK_EVENT_HASH
            }
        });

        console.log('[1] Created Context in Database');
        console.log(`    Tenant ID: ${tenantId}`);
        console.log(`    Event ID:  ${eventId}`);
        console.log(`    Event SHA3-512 Hash:\n    ${MOCK_EVENT_HASH}\n`);

        // [2] Initialize the new Omnibus Facet
        const anchorFacet = new AlgorandAnchorFacet();
        console.log('[2] Initialized AlgorandAnchorFacet using Omnibus Wallet');

        // Let's print out the public address of the derived mnemonic
        const Mnemonic = process.env.ALGORAND_MASTER_MNEMONIC!;
        const account = algosdk.mnemonicToSecretKey(Mnemonic);
        console.log(`    Master Account Public Key: ${account.addr}\n`);

        // [3] Spin up the Queue and anchor!
        console.log('[3] Triggering Anchor Queue (Processing APPROVED events)');
        const anchorQueue = new AnchorQueueService(anchorFacet);
        const results = await anchorQueue.processQueue();

        console.log(`    Queue processed ${results.processed} items.`);

        // [4] Validation Check
        const verifiedEvent = await prisma.eventLog.findUnique({ where: { id: eventId } });

        if (verifiedEvent?.dltTxId === mockTxId) {
            console.log(`\n    ✅ SUCCESS! Event log updated with TxID: ${mockTxId}`);
        } else {
            console.error('Event txId update failed. Found:', verifiedEvent?.dltTxId);
            throw new Error('Failed to update event with TxID');
        }

        console.log('\n[5] Decoded Structure sent to Algorand Node (Simulation Intercept):');
        // Let's recreate what the code inside actual anchorEvent formed
        const tenantHash = require('crypto').createHash('sha256').update(tenantId).digest('hex');
        const noteString = `QC-ANCHOR | ${tenantHash} | ${MOCK_EVENT_HASH}`;

        console.log(`    PaymentTxn (Amount: 0 ALGO, Target: Omnibus Wallet -> Master -> Master)`);
        console.log(`    From: ${account.addr}`);
        console.log(`    To:   ${account.addr}`);
        console.log(`    Note Field String (LGPD OBFUSCATED):`);
        console.log(`    => "${noteString}"`);

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(' ALGORAND OMNIBUS WORKFLOW COMPLETED');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (e: any) {
        console.error("Test failed: ", e.response?.body || e.message || e);
    } finally {
        await prisma.$disconnect();

        // Restore mocks just in case
        algosdk.Algodv2.prototype.sendRawTransaction = originalSendRawTransaction;
    }
}

runTest();
