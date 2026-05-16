import { RequestHandler } from 'express';

export function createDocumentPaymentGate(): RequestHandler {
  return (_req, res, next) => {
    if (process.env.X402_ENABLED !== 'true') {
      return next();
    }

    return res.status(501).json({
      success: false,
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      error: 'Document verification payment provider is not configured.',
    });
  };
}
