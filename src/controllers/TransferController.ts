// src/controllers/TransferController.ts
// ═══════════════════════════════════════════════════════════
// REST Controller: Asset Transfer Initiation
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Slim REST wrapper around TransferRegistryFacet.initiateTransfer.
// secureContext is ALWAYS sourced from req (injected by requireApiKey middleware),
// NEVER from the request body (T-03-01: Elevation of Privilege mitigation).
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { TransferRegistryFacet } from '../services/core-facets/TransferRegistryFacet';

export class TransferController {
  static async initiateTransfer(req: Request, res: Response, next: NextFunction) {
    try {
      // T-03-01: secureContext is NEVER read from req.body — only from middleware-injected fields
      const secureContext = {
        tenantId: (req as any).tenantId,
        role: (req as any).apiKeyRole,
        apiKeyId: (req as any).apiKeyId,
      };

      const payload = {
        assetId: req.params.assetId,
        buyerDocument: req.body.buyerDocument,
        documentType: req.body.documentType,
      };

      const result = await TransferRegistryFacet.initiateTransfer(secureContext, payload);

      return res.status(200).json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          facet: 'TRANSFER',
        },
      });
    } catch (err: any) {
      if (err.code === 'ASSET_NOT_FOUND') {
        return res.status(404).json({ success: false, error: err.message, code: err.code });
      }
      if (err.code === 'INSUFFICIENT_PERMISSIONS') {
        return res.status(403).json({ success: false, error: err.message, code: err.code });
      }
      if (err.code === 'INVALID_ASSET_STATE') {
        return res.status(422).json({ success: false, error: err.message, code: err.code });
      }
      if (err.httpStatus) {
        return res.status(err.httpStatus).json({ success: false, error: err.message, code: err.code });
      }
      next(err);
    }
  }
}
