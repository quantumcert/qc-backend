import prisma from '../../config/prisma';
import { BillingFacet } from './BillingFacet';

export class TransferRegistryFacet {
    /**
     * Initiates the ownership transfer of an Asset.
     */
    static async initiateTransfer(secureContext: any, payload: { assetId: string, buyerEmail: string }) {
        const { tenantId, role } = secureContext;
        const { assetId, buyerEmail } = payload;

        // Ensure proper privileges
        if (role !== 'ADMIN' && role !== 'OPERATOR') {
            throw new Error('Forbidden: Insufficient privileges to initiate transfer');
        }

        // Validate Asset ownership and status securely
        const asset = await prisma.asset.findUnique({
            where: { id: assetId, tenantId },
            include: { tenant: true } // Need Tenant config for custom pricing
        });

        if (!asset) throw new Error('Asset not found or access denied limit.');
        if (asset.status !== 'ACTIVE') throw new Error(`Asset cannot be transferred from current state: ${asset.status}`);

        // Phase X: Dynamic Pricing 
        // Checks if Tenant negotiated custom fees. If not, fallback to default R$49.99
        const fee = asset.tenant.customTransferFee || 49.99;

        // Set status strictly to await payment completion
        await prisma.asset.update({
            where: { id: asset.id },
            data: { status: 'AWAITING_PAYMENT' }
        });

        // Generate Intent event 
        await prisma.eventLog.create({
            data: {
                assetId: asset.id,
                tenantId: asset.tenantId,
                origin: secureContext.apiKeyId || 'MANUAL',
                status: 'APPROVED',
                payload: { action: 'TRANSFER_INITIATED', target: buyerEmail, fee }
            }
        });

        // Engine: Billing via Mercado Pago
        const billing = await BillingFacet.createPaymentPreference(secureContext, {
            assetId: asset.id,
            title: `Ownership Transfer: ${asset.externalId}`,
            amount: fee,
            ownerEmail: buyerEmail
        });

        // Concept: "Shadow Account"
        // Registers the buyer pending full verification. The transfer resolves entirely
        // once Mercado Pago confirms the invoice.
        await prisma.owner.create({
            data: {
                assetId: asset.id,
                ownerRef: buyerEmail, // Can be CPF/Email
                label: 'Shadow Account (Pending Payment)'
            }
        });

        return {
            success: true,
            assetId: asset.id,
            status: 'AWAITING_PAYMENT',
            paymentLink: billing.initPoint,
            buyerAddress: buyerEmail
        };
    }
}
