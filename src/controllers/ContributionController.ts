// ═══════════════════════════════════════════════════════════
// CONTRIBUTION CONTROLLER — CORE-06
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Slim controller for the authenticated review endpoint.
// Delegates all business logic to CurationFacet.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { CurationFacet } from '../services/core-facets/CurationFacet';

export class ContributionController {
    static async review(req: Request, res: Response, next: NextFunction) {
        try {
            const secureContext = {
                tenantId: (req as any).tenantId,
                role: (req as any).apiKeyRole,
                apiKeyId: (req as any).apiKeyId,
            };
            const payload = {
                pendingId: req.params.id,
                decision: req.body.decision,
                reason: req.body.reason,
            };

            const result = await CurationFacet.reviewContribution(secureContext, payload);

            return res.status(200).json({
                success: true,
                data: result,
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: 'CURATION',
                },
            });
        } catch (err: any) {
            if (err.httpStatus) {
                return res.status(err.httpStatus).json({
                    success: false,
                    error: err.message,
                    code: err.code,
                });
            }
            next(err);
        }
    }
}
