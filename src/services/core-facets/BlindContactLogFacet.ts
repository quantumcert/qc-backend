import prisma from '../../config/prisma';
import { WebhookDispatcher } from '../../utils/WebhookDispatcher';

export class BlindContactLogFacet {
    static async submitContact(assetId: string, contactData: Record<string, any>, requesterIp: string | null) {
        return await prisma.$transaction(async (tx) => {
            const asset = await tx.asset.findUnique({
                where: { id: assetId }
            });

            if (!asset) {
                throw new Error("ASSET_NOT_FOUND");
            }

            if (asset.status !== 'ALERT') {
                throw new Error("ASSET_NOT_IN_ALERT");
            }

            const blindContact = await tx.blindContactLog.create({
                data: {
                    assetId,
                    tenantId: asset.tenantId,
                    contactData,
                    originIp: requesterIp
                }
            });

            BlindContactLogFacet.triggerAlertNotification(asset.tenantId, blindContact.id, asset.id);

            return blindContact;
        });
    }

    private static triggerAlertNotification(tenantId: string, contactId: string, assetId: string) {
        WebhookDispatcher.dispatch(tenantId, 'BLIND_CONTACT_CREATED', {
            contactId,
            assetId,
            message: 'New Finder Contact recorded'
        });
    }
}
