// ═══════════════════════════════════════════════════════════
// TRANSFER CONTROLLER
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Handles asset ownership transfer initiation via TransferRegistryFacet.
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { TransferRegistryFacet } from '../services/core-facets/TransferRegistryFacet';

const TransferSchema = z.object({
    buyerDocument: z.string().min(11).max(18), // 11 digits CPF or 14 digits CNPJ (with or without mask)
    documentType: z.enum(['CPF', 'CNPJ']),
});

export class TransferController {
    static async initiate(req: AuthenticatedRequest, res: Response) {
        try {
            const { assetId } = req.params;
            const body = TransferSchema.parse(req.body);

            const secureContext = {
                tenantId: req.tenantId!,
                apiKeyId: req.apiKeyId!,
                role: req.apiKeyRole as string,
            };

            const result = await TransferRegistryFacet.initiateTransfer(secureContext, {
                assetId,
                ...body,
            });

            return res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return res.status(400).json({ success: false, error: error.errors });
            }
            const status = error.httpStatus ?? 400;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }
    }
}
