import prisma from '../../config/prisma';

type AssetStatus =
    | 'DRAFT'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'ARCHIVED'
    | 'BURNED'
    | 'AWAITING_PAYMENT'
    | 'LOCKED_IN_ESCROW'
    | 'ALERT'
    | 'INACTIVE';

interface PublicAssetPanel {
    status: AssetStatus;
    name: string | null;
    sku: string | null;
    serialNumber: string | null;
    pqcSigned: boolean;
    dltExplorerUrl: string | null;
}

export interface VerifyDocumentResponse {
    valid: boolean;
    asset: PublicAssetPanel | null;
    // Internal mapping for the route to determine HTTP status.
    reason?: string;
}

function extractAssetPublicFields(metadata: any): {
    name: string | null;
    sku: string | null;
    serialNumber: string | null;
} {
    if (!metadata || typeof metadata !== 'object') {
        return { name: null, sku: null, serialNumber: null };
    }

    const name = typeof metadata.name === 'string' ? metadata.name : null;
    const sku = typeof metadata.sku === 'string' ? metadata.sku : null;
    const serialNumber = typeof metadata.serialNumber === 'string' ? metadata.serialNumber : null;

    return { name, sku, serialNumber };
}

function buildExplorerUrl(chain: string | null | undefined, dltTxId: string | null | undefined): string | null {
    if (!chain || !dltTxId) return null;

    switch (chain) {
        case 'ALGORAND':
            return `https://algoexplorer.io/tx/${dltTxId}`;
        case 'SOLANA':
            return `https://explorer.solana.com/tx/${dltTxId}`;
        case 'STELLAR':
            return `https://stellar.expert/explorer/public/tx/${dltTxId}`;
        default:
            return null;
    }
}

export class DocumentVerificationFacet {
    static async verifyByHash(hash: string): Promise<VerifyDocumentResponse> {
        // Hash received is SHA3-512 => 128 hex chars.
        if (!/^[a-f0-9]{128}$/i.test(hash)) {
            return { valid: false, asset: null, reason: 'Invalid hash format' };
        }

        // Document hash is stored on EventLog.documentHash.
        // Load the Asset and the anchoring fields needed for dltExplorerUrl.
        const event = await prisma.eventLog.findFirst({
            where: { documentHash: hash },
            select: {
                id: true,
                assetId: true,
                asset: {
                    select: {
                        status: true,
                        metadata: true,
                    },
                },
                dltTxId: true,
            },
        });

        if (!event) {
            return { valid: false, asset: null };
        }

        const assetStatus = event.asset.status as AssetStatus;
        const { name, sku, serialNumber } = extractAssetPublicFields(event.asset.metadata);

        // pqcSigned is true if a Falcon-512 signature exists linked to this asset.
        // This implementation checks whether any PQC proof signatureHash exists in EventLog.
        // (No tenant/audit fields exposed.)
        const pqcEvent = await prisma.eventLog.findFirst({
            where: {
                assetId: event.assetId,
                signatureHash: { not: null },
            },
            select: { id: true },
        });

        const pqcSigned = Boolean(pqcEvent);

        // chain must be resolved from the stored DLT transaction context.
        // If not present in this record, dltExplorerUrl is returned as null.
        const chain = (event as any).chain as string | null | undefined;
        const dltExplorerUrl = buildExplorerUrl(chain, event.dltTxId);


        return {
            valid: true,
            asset: {
                status: assetStatus,
                name,
                sku,
                serialNumber,
                pqcSigned,
                dltExplorerUrl,
            },
        };
    }
}

