import 'dotenv/config';
import prisma from '../config/prisma';
import {
  ASSET_REGISTRATION_ORIGIN,
  AssetAnchoringService,
} from '../services/AssetAnchoringService';
import { AnchorQueueService } from '../services/AnchorQueueService';

const DEFAULT_TENANT_ID = 'cmonsgytb0000rmix0q7zruru';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const tenantId = argValue('--tenant') || process.env.TENANT_ID || DEFAULT_TENANT_ID;
  const assetId = argValue('--asset');
  const execute = process.argv.includes('--execute');
  const anchor = process.argv.includes('--anchor');
  const batchSize = Math.min(Math.max(Number(argValue('--batch-size') || 25), 1), 100);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, targetChain: true, isActive: true },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  if (tenant.targetChain !== 'STELLAR') {
    throw new Error(`Tenant ${tenantId} targetChain is ${tenant.targetChain}, expected STELLAR.`);
  }

  let scannedAssets = 0;
  let existingRegistrationEvents = 0;
  let createdRegistrationEvents = 0;
  let cursor: string | undefined;

  while (true) {
    const assets = await prisma.asset.findMany({
      where: { tenantId, ...(assetId ? { id: assetId } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (assets.length === 0) break;

    for (const asset of assets) {
      scannedAssets += 1;

      const existing = await prisma.eventLog.findFirst({
        where: {
          tenantId,
          assetId: asset.id,
          origin: ASSET_REGISTRATION_ORIGIN,
        },
        select: { id: true, dltTxId: true, status: true },
      });

      if (existing) {
        existingRegistrationEvents += 1;
        continue;
      }

      if (execute) {
        await AssetAnchoringService.createAssetRegistrationEvent(prisma, asset, {
          issuerId: 'backfill-stellar-asset-anchors',
        });
      }

      createdRegistrationEvents += 1;
    }

    cursor = assets[assets.length - 1].id;
  }

  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    tenant,
    assetId: assetId ?? null,
    scannedAssets,
    existingRegistrationEvents,
    createdRegistrationEvents,
  }, null, 2));

  if (assetId && scannedAssets === 0) {
    throw new Error(`Asset ${assetId} not found for tenant ${tenantId}.`);
  }

  if (execute && anchor) {
    let processed = 0;
    let failed = 0;

    while (true) {
      const result = await AnchorQueueService.processQueue({ tenantId, assetId });
      processed += result.processed;
      failed += result.items.filter(item => !item.success).length;

      if (result.processed === 0) break;
    }

    console.log(JSON.stringify({
      anchorQueue: {
        processed,
        failed,
      },
    }, null, 2));
  }

  if (execute) {
    const [anchoredRegistrationEvents, pendingRegistrationEvents, retryQueuedRegistrationEvents] = await Promise.all([
      prisma.eventLog.count({
        where: {
          tenantId,
          ...(assetId ? { assetId } : {}),
          origin: ASSET_REGISTRATION_ORIGIN,
          dltTxId: { not: null },
          NOT: { dltTxId: { in: ['PROCESSING', 'RETRY_QUEUED'] } },
        },
      }),
      prisma.eventLog.count({
        where: {
          tenantId,
          ...(assetId ? { assetId } : {}),
          origin: ASSET_REGISTRATION_ORIGIN,
          dltTxId: null,
        },
      }),
      prisma.eventLog.count({
        where: {
          tenantId,
          ...(assetId ? { assetId } : {}),
          origin: ASSET_REGISTRATION_ORIGIN,
          dltTxId: 'RETRY_QUEUED',
        },
      }),
    ]);

    console.log(JSON.stringify({
      registrationEventStatus: {
        anchoredRegistrationEvents,
        pendingRegistrationEvents,
        retryQueuedRegistrationEvents,
      },
    }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
