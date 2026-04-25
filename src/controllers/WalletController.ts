// ============================================================
// WALLET CONTROLLER
// API endpoints for custodial wallet operations.
//
// GET /wallet/deposit-address  -> Returns deposit address for a chain
// GET /wallet/balance          -> Returns internal balance (deposits - spent)
// ============================================================

import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { WalletService, SupportedWalletChain } from '../services/WalletService';

const DepositAddressSchema = z.object({
  chain: z.enum(['ETHEREUM', 'POLYGON', 'ALGORAND']),
});

const BalanceSchema = z.object({
  chain: z.enum(['ETHEREUM', 'POLYGON', 'ALGORAND']).optional(),
});

export class WalletController {
  /**
   * GET /wallet/deposit-address
   * Returns the custodial deposit address for the authenticated tenant
   * on the requested blockchain.
   */
  static async getDepositAddress(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.tenantId!;
      const query = DepositAddressSchema.parse(req.query);

      const walletService = WalletService.getInstance();
      const result = await walletService.getDepositAddress(
        tenantId,
        query.chain as SupportedWalletChain
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ success: false, error: error.errors });
      }
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * GET /wallet/balance
   * Returns the internal balance for the authenticated tenant.
   * Aggregates all CONFIRMED deposits minus spent assets.
   */
  static async getBalance(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.tenantId!;
      const query = BalanceSchema.parse(req.query);

      const walletService = WalletService.getInstance();
      const result = await walletService.getBalance(
        tenantId,
        query.chain as SupportedWalletChain | undefined
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ success: false, error: error.errors });
      }
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

