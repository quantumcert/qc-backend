import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
    mockAsset,
    mockEventLog,
    mockWebhookInbox,
    mockTransaction,
    mockPaymentGet,
    mockQueryRaw,
} = vi.hoisted(() => {
    const mockAsset = { findFirst: vi.fn(), update: vi.fn() };
    const mockEventLog = { create: vi.fn() };
    const mockWebhookInbox = { update: vi.fn(), updateMany: vi.fn() };
    const mockQueryRaw = vi.fn();
    const mockTransaction = vi.fn(async (cb: any) =>
        cb({
            $queryRaw: mockQueryRaw,
            webhookInbox: mockWebhookInbox,
        })
    );
    const mockPaymentGet = vi.fn();

    return { mockAsset, mockEventLog, mockWebhookInbox, mockTransaction, mockPaymentGet, mockQueryRaw };
});

vi.mock('../src/config/prisma', () => ({
    default: {
        asset: mockAsset,
        eventLog: mockEventLog,
        webhookInbox: mockWebhookInbox,
        $transaction: mockTransaction,
    },
}));

vi.mock('mercadopago', () => ({
    MercadoPagoConfig: vi.fn(),
    Preference: vi.fn(),
    Payment: vi.fn(() => ({
        get: mockPaymentGet,
    })),
}));

import { BillingFacet } from '../src/services/core-facets/BillingFacet';

describe('BillingFacet security regressions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MP_ACCESS_TOKEN = 'TEST_TOKEN';
        mockTransaction.mockImplementation(async (cb: any) =>
            cb({
                $queryRaw: mockQueryRaw,
                webhookInbox: mockWebhookInbox,
            })
        );
    });

    afterEach(() => {
        delete process.env.MP_ACCESS_TOKEN;
    });

    it('requires tenant metadata before activating an asset from a webhook', async () => {
        mockPaymentGet.mockResolvedValue({
            status: 'approved',
            external_reference: 'asset_001',
            metadata: {},
        });

        const result = await BillingFacet.processPaymentWebhook({}, { data: { id: 'pay_001' } });

        expect(result).toMatchObject({
            success: false,
            error: 'Missing tenant context in payment metadata',
        });
        expect(mockAsset.findFirst).not.toHaveBeenCalled();
        expect(mockAsset.update).not.toHaveBeenCalled();
    });

    it('atomically locks pending webhook inbox rows before processing', async () => {
        mockQueryRaw.mockResolvedValue([]);

        await BillingFacet.processWebhookInbox();

        expect(mockTransaction).toHaveBeenCalledOnce();
        expect(mockQueryRaw).toHaveBeenCalledOnce();
        expect(mockWebhookInbox.updateMany).not.toHaveBeenCalled();
    });
});
