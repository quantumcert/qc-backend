import { Response } from 'express';
import { z } from 'zod';
import {
    CreditLedgerEntryType,
    PaymentEventStatus,
    Prisma,
    PurchaseOrderStatus,
    PurchaseOrderType,
} from '@prisma/client';
import {
    CreditLedgerError,
    CreditLedgerFacet,
} from '../services/core-facets/CreditLedgerFacet';
import {
    ReceivablesProviderError,
    ReceivablesProviderFacet,
} from '../services/core-facets/ReceivablesProviderFacet';
import { AdminAuthorizationError } from '../services/core-facets/AdminAuthorizationFacet';
import { AuthenticatedRequest, DiamondFacets } from '../types';

const listSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ledgerListSchema = listSchema.extend({
    userId: z.string().trim().min(1).optional(),
    entryType: z.nativeEnum(CreditLedgerEntryType).optional(),
});

const creditMutationSchema = z.object({
    amount: z.number().int().positive(),
    userId: z.string().trim().min(1).nullable().optional(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    referenceType: z.string().trim().min(1).optional(),
    referenceId: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
});

const creditAdjustmentSchema = creditMutationSchema.omit({ amount: true }).extend({
    delta: z.number().int().refine((value) => value !== 0, {
        message: 'delta must be non-zero',
    }),
});

const createPurchaseIntentSchema = z.object({
    credits: z.number().int().positive(),
    amount: z.string().trim().min(1),
    currency: z.string().trim().min(3).max(6),
    provider: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1),
    metadata: z.record(z.unknown()).optional(),
});

const purchaseOrderListSchema = listSchema.extend({
    status: z.nativeEnum(PurchaseOrderStatus).optional(),
    type: z.nativeEnum(PurchaseOrderType).optional(),
});

const paymentEventListSchema = listSchema.extend({
    tenantId: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
    status: z.nativeEnum(PaymentEventStatus).optional(),
});

export class AdminCreditController {
    static async getCreditSummary(req: AuthenticatedRequest, res: Response) {
        try {
            const query = z.object({
                userId: z.string().trim().min(1).optional(),
            }).parse(req.query);
            const result = await CreditLedgerFacet.getBalance(
                req.adminActor!,
                req.params.tenantId,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta(DiamondFacets.CREDIT_LEDGER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.getCreditSummary]');
        }
    }

    static async listCreditLedger(req: AuthenticatedRequest, res: Response) {
        try {
            const query = ledgerListSchema.parse(req.query);
            const result = await CreditLedgerFacet.listEntries(
                req.adminActor!,
                req.params.tenantId,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta(DiamondFacets.CREDIT_LEDGER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.listCreditLedger]');
        }
    }

    static async grantCredits(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = creditMutationSchema.parse(req.body);
            const result = await CreditLedgerFacet.grantCredits(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    metadata: payload.metadata as Prisma.InputJsonValue | undefined,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({ success: true, data: result, meta: buildMeta(DiamondFacets.CREDIT_LEDGER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.grantCredits]');
        }
    }

    static async adjustCredits(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = creditAdjustmentSchema.parse(req.body);
            const result = await CreditLedgerFacet.adjustCredits(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    metadata: payload.metadata as Prisma.InputJsonValue | undefined,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({ success: true, data: result, meta: buildMeta(DiamondFacets.CREDIT_LEDGER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.adjustCredits]');
        }
    }

    static async revokeCredits(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = creditMutationSchema.parse(req.body);
            const result = await CreditLedgerFacet.revokeCredits(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    metadata: payload.metadata as Prisma.InputJsonValue | undefined,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                }
            );

            return res.status(201).json({ success: true, data: result, meta: buildMeta(DiamondFacets.CREDIT_LEDGER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.revokeCredits]');
        }
    }

    static async createCreditPurchaseIntent(req: AuthenticatedRequest, res: Response) {
        try {
            const payload = createPurchaseIntentSchema.parse(req.body);
            const result = await ReceivablesProviderFacet.createCreditPurchaseIntent(
                req.adminActor!,
                req.params.tenantId,
                {
                    ...payload,
                    metadata: payload.metadata as Prisma.InputJsonValue | undefined,
                }
            );

            return res.status(201).json({ success: true, data: result, meta: buildMeta(DiamondFacets.RECEIVABLES_PROVIDER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.createCreditPurchaseIntent]');
        }
    }

    static async listPurchaseOrders(req: AuthenticatedRequest, res: Response) {
        try {
            const query = purchaseOrderListSchema.parse(req.query);
            const result = await ReceivablesProviderFacet.listPurchaseOrders(
                req.adminActor!,
                req.params.tenantId,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta(DiamondFacets.RECEIVABLES_PROVIDER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.listPurchaseOrders]');
        }
    }

    static async listPaymentEvents(req: AuthenticatedRequest, res: Response) {
        try {
            const query = paymentEventListSchema.parse(req.query);
            const result = await ReceivablesProviderFacet.listPaymentEvents(
                req.adminActor!,
                query
            );

            return res.json({ success: true, data: result, meta: buildMeta(DiamondFacets.RECEIVABLES_PROVIDER) });
        } catch (error) {
            return respondWithAdminCreditError(error, res, '[AdminCreditController.listPaymentEvents]');
        }
    }
}

function buildMeta(facet: string) {
    return {
        timestamp: new Date().toISOString(),
        facet,
    };
}

function respondWithAdminCreditError(error: unknown, res: Response, logPrefix: string) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: error.errors,
        });
    }

    if (
        error instanceof CreditLedgerError
        || error instanceof ReceivablesProviderError
        || error instanceof AdminAuthorizationError
    ) {
        const statusMap: Record<string, number> = {
            ADMIN_ACTOR_REQUIRED: 401,
            ADMIN_REASON_REQUIRED: 400,
            PLATFORM_ADMIN_REQUIRED: 403,
            TENANT_SCOPE_FORBIDDEN: 403,
            TENANT_NOT_FOUND: 404,
            INVALID_AMOUNT: 400,
            INVALID_CURRENCY: 400,
            IDEMPOTENCY_KEY_REQUIRED: 400,
            INSUFFICIENT_CREDITS: 409,
            INSUFFICIENT_RESERVED_CREDITS: 409,
            PROVIDER_NOT_CONFIGURED: 409,
            INVALID_WEBHOOK_SIGNATURE: 401,
            INVALID_PROVIDER_PAYLOAD: 400,
        };

        return res.status(statusMap[error.code] || 400).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }

    console.error(logPrefix, error);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
}
