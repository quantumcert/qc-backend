// src/services/core-facets/TransferRegistryFacet.ts
import prisma from '../../config/prisma';
import { BillingFacet } from './BillingFacet';

interface SecureContext {
    tenantId: string;
    apiKeyId?: string;
    role: string;
}

interface TransferPayload {
    assetId: string;
    buyerDocument: string;    // CPF or CNPJ, may have mask
    documentType: 'CPF' | 'CNPJ';
}

export class TransferRegistryFacet {
    static async initiateTransfer(secureContext: SecureContext, payload: TransferPayload) {
        const { tenantId, apiKeyId, role } = secureContext;
        const { assetId, documentType } = payload;

        // Normalize: strip mask characters (dots, dashes, slashes)
        const buyerDocument = payload.buyerDocument.replace(/\D/g, '');

        if (role !== 'ADMIN' && role !== 'OPERATOR') {
            const err: any = new Error('Forbidden: Insufficient privileges to initiate transfer');
            err.code = 'INSUFFICIENT_PERMISSIONS';
            throw err;
        }

        const asset = await prisma.asset.findUnique({
            where: { id: assetId, tenantId },
            include: { tenant: true },
        });

        if (!asset) {
            const err: any = new Error('Asset not found or access denied');
            err.code = 'ASSET_NOT_FOUND';
            throw err;
        }

        if (asset.status !== 'ACTIVE') {
            const err: any = new Error(`Asset cannot be transferred from state: ${asset.status}`);
            err.code = 'INVALID_ASSET_STATE';
            throw err;
        }

        const fee = (asset.tenant as any).customTransferFee || 49.99;

        // Shadow Account: lookup or create by document within this asset
        let owner = await prisma.owner.findFirst({
            where: { assetId, document: buyerDocument },
        });

        if (!owner) {
            owner = await prisma.owner.create({
                data: {
                    assetId,
                    ownerRef: buyerDocument,
                    document: buyerDocument,
                    documentType,
                    label: 'Shadow Account (Pending Payment)',
                },
            });
        }

        await prisma.asset.update({
            where: { id: asset.id },
            data: { status: 'AWAITING_PAYMENT' },
        });

        await prisma.eventLog.create({
            data: {
                assetId: asset.id,
                tenantId: asset.tenantId,
                origin: apiKeyId || 'MANUAL',
                status: 'APPROVED',
                payload: {
                    action: 'TRANSFER_INITIATED',
                    buyerDocument,
                    documentType,
                    fee,
                    buyerOwnerId: owner.id,
                },
            },
        });

        const billing = await BillingFacet.createPaymentPreference(secureContext, {
            assetId: asset.id,
            title: `Ownership Transfer: ${asset.externalId}`,
            amount: fee,
            ownerEmail: buyerDocument, // BillingFacet uses this as payer reference
        });

        return {
            assetId: asset.id,
            status: 'AWAITING_PAYMENT',
            paymentLink: billing.initPoint,
            buyerDocument,
            documentType,
            buyerOwnerId: owner.id,
        };
    }
}
