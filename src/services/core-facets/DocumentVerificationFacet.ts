import prisma from '../../config/prisma';

export interface VerifyDocumentResponse {
    verified: boolean;
    // Returned only when verified is true
    assetId?: string;
    assetStatus?: string;
    dltTxId?: string | null;
    anchoredAt?: Date;
    eventId?: string;
    issuerId?: string | null;
    // Returned only when verified is false
    reason?: string;
}

export class DocumentVerificationFacet {
    /**
     * Verifies a document by its SHA3-512 hash.
     * Hash is computed client-side (WebCrypto API) — the raw file is never sent to the backend.
     *
     * @param hash SHA3-512 hex string (128 characters)
     * @returns VerifyDocumentResponse with verified flag and proof details
     */
    static async verifyByHash(hash: string): Promise<VerifyDocumentResponse> {
        // Hash received is SHA3-512 => 128 hex chars.
        if (!/^[a-f0-9]{128}$/i.test(hash)) {
            return { verified: false };
        }

        // Document hash is stored on EventLog.documentHash.
        // Load the Asset status and anchoring fields for the proof panel.
        const event = await prisma.eventLog.findFirst({
            where: { documentHash: hash },
            include: {
                asset: { select: { status: true } },
            },
        });

        if (!event) {
            return { verified: false };
        }

        return {
            verified: true,
            assetId: event.assetId,
            assetStatus: event.asset.status,
            dltTxId: event.dltTxId,
            anchoredAt: event.updatedAt,
            eventId: event.id,
            issuerId: event.issuerId ?? null,
        };
    }
}
