import prisma from '../../config/prisma';

export type DocumentVerificationFailureReason = 'INVALID_DOCUMENT_HASH' | 'DOCUMENT_NOT_FOUND';

export interface VerifyDocumentResponse {
    verified: boolean;
    // Returned only when verified is true
    assetId?: string;
    assetStatus?: string;
    publicUrl?: string | null;
    dltTxId?: string | null;
    chain?: string;
    anchoredAt?: Date;
    eventId?: string;
    issuerId?: string | null;
    confirmationStatus?: string;
    // Returned only when verified is false
    reason?: DocumentVerificationFailureReason;
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
            return { verified: false, reason: 'INVALID_DOCUMENT_HASH' };
        }

        // Document hash is stored on EventLog.documentHash.
        // Load the Asset status and anchoring fields for the proof panel.
        const event = await prisma.eventLog.findFirst({
            where: { documentHash: hash },
            include: {
                asset: { select: { status: true, publicUrl: true } },
            },
        });

        if (!event) {
            return { verified: false, reason: 'DOCUMENT_NOT_FOUND' };
        }

        const anchorTx = await prisma.chainTransaction.findFirst({
            where: { txRef: event.id, direction: 'ANCHOR' },
            orderBy: { createdAt: 'desc' },
        });

        return {
            verified: true,
            assetId: event.assetId,
            assetStatus: event.asset.status,
            publicUrl: event.asset.publicUrl,
            dltTxId: anchorTx?.chainTxId ?? event.dltTxId,
            chain: anchorTx?.chain,
            anchoredAt: anchorTx?.confirmedAt ?? event.updatedAt,
            eventId: event.id,
            issuerId: event.issuerId ?? null,
            confirmationStatus: anchorTx?.status ?? (event.dltTxId ? 'CONFIRMED' : 'PENDING'),
        };
    }
}
