// ═══════════════════════════════════════════════════════════
// LIFECYCLE CONTROLLER
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Handles asset state transitions via LifecycleFacet.
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { LifecycleFacet } from '../services/core-facets/LifecycleFacet';

const TransitionSchema = z.object({
    targetState: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BURNED']),
    reason: z.string().max(500).optional(),
});

export class LifecycleController {
    static async transition(req: AuthenticatedRequest, res: Response) {
        try {
            const { assetId } = req.params;
            const body = TransitionSchema.parse(req.body);

            const secureContext = {
                tenantId: req.tenantId!,
                apiKeyId: req.apiKeyId!,
                role: req.apiKeyRole as string,
            };

            const result = await LifecycleFacet.transition(secureContext, { assetId, ...body });

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
