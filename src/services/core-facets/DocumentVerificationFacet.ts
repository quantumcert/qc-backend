import prisma from '../../config/prisma';

interface VerificationResult {
    verified: boolean;
    reason?: string;
    assetId?: string;
    assetStatus?: string;
    dltTxId?: string | null;
    anchoredAt?: Date;
    eventId?: string;
    issuerId?: string | null;
}

export class DocumentVerificationFacet {
    static async verifyByHash(hash: string): Promise<VerificationResult> {
        if (!/^[a-f0-9]{128}$/i.test(hash)) {
            return { verified: false, reason: 'Invalid hash format' };
        }

        const event = await prisma.eventLog.findFirst({
            where: { documentHash: hash },
            include: { asset: { select: { status: true } } },
        });

        if (!event) {
            return { verified: false, reason: 'Document not found in registry' };
        }

        return {
            verified: true,
            assetId: event.assetId,
            assetStatus: (event as any).asset.status,
            dltTxId: event.dltTxId,
            anchoredAt: event.updatedAt,
            eventId: event.id,
            issuerId: event.issuerId,
        };
    }
}
