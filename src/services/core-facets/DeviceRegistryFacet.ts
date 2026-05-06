import prisma from '../../config/prisma';
import { CryptoService } from '../CryptoService';
import { AuditActions, ResourceTypes } from '../../types';

export class DeviceRegistryFacet {
    /**
     * Protected provisioning endpoint for Factory / Master Admin.
     * Registers a pre-provisioned hardware tag and links it to an Asset.
     * ZERO-KNOWLEDGE: masterKeyPlain is isolated and AES-256-GCM encrypted.
     */
    static async registerDevice(assetId: string, tenantId: string, uid: string, masterKeyPlain: string) {
        if (!assetId || !tenantId || !uid || !masterKeyPlain) {
            throw new Error("Missing required parameters for Device provisioning.");
        }

// Zero-knowledge: Encrypt masterKey before storage
        const encryptedMasterKey = CryptoService.encryptJson(masterKeyPlain);

        return await prisma.$transaction(async (tx) => {
            // Verify Asset exists and belongs to the specified Tenant
            const asset = await tx.asset.findUnique({
                where: { id: assetId }
            });

            if (!asset) {
                throw new Error("Asset not found");
            }

            if (asset.tenantId !== tenantId) {
                throw new Error("Asset does not belong to the specified Tenant");
            }

            if (asset.deviceId) {
                throw new Error("Asset is already linked to a hardware device");
            }

            // Create the secured hardware record
            const device = await tx.device.create({
                data: {
                    uid: uid,
                    tenantId: tenantId,
                    lastCounter: 0,
                    masterKey: encryptedMasterKey
                }
            });

            // Link Device to Asset
            await tx.asset.update({
                where: { id: asset.id },
                data: { deviceId: device.id }
            });

            // Audit Trail
            await tx.auditLog.create({
                data: {
                    tenantId: tenantId,
                    action: AuditActions.DEVICE_REGISTERED,
                    resourceType: ResourceTypes.DEVICE,
                    resourceId: device.id,
                    metadata: { uid: uid, assetId: asset.id, provisionedOffline: true }
                }
            });

            return device;
        });
    }
}
