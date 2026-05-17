import { Request, Response } from 'express';
import {
    ReceivablesProviderError,
    ReceivablesProviderFacet,
} from '../services/core-facets/ReceivablesProviderFacet';

export class ReceivablesWebhookController {
    static async handleProviderWebhook(req: Request, res: Response) {
        try {
            const result = await ReceivablesProviderFacet.recordPaymentWebhook({
                provider: req.params.provider,
                headers: req.headers,
                body: req.body,
            });

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            if (error instanceof ReceivablesProviderError) {
                const statusMap: Record<string, number> = {
                    INVALID_WEBHOOK_SIGNATURE: 401,
                    PROVIDER_NOT_CONFIGURED: 404,
                    INVALID_PROVIDER_PAYLOAD: 400,
                };

                return res.status(statusMap[error.code] || 400).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                });
            }

            console.error('[ReceivablesWebhookController.handleProviderWebhook]', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error.',
            });
        }
    }
}
