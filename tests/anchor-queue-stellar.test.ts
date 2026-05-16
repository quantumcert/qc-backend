import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockPrismaTransaction,
    mockQueryRaw,
    mockTransactionUpdateMany,
    mockEventLogUpdate,
    mockEventLogUpdateMany,
    mockTenantFindMany,
    mockGetAdapter,
    mockWebhookDispatch,
    mockRetryEnqueue,
    stellarAdapter,
    algorandAdapter,
} = vi.hoisted(() => {
    const mockQueryRaw = vi.fn();
    const mockTransactionUpdateMany = vi.fn();
    const mockEventLogUpdate = vi.fn();
    const mockEventLogUpdateMany = vi.fn();
    const mockTenantFindMany = vi.fn();
    const stellarAdapter = { anchorEvent: vi.fn() };
    const algorandAdapter = { anchorEvent: vi.fn() };
    const mockGetAdapter = vi.fn((chain: string) => {
        if (chain === 'STELLAR') return stellarAdapter;
        if (chain === 'ALGORAND') return algorandAdapter;
        throw new Error(`Unexpected chain: ${chain}`);
    });
    const mockPrismaTransaction = vi.fn(async (cb: any) => cb({
        $queryRaw: mockQueryRaw,
        eventLog: { updateMany: mockTransactionUpdateMany },
    }));

    return {
        mockPrismaTransaction,
        mockQueryRaw,
        mockTransactionUpdateMany,
        mockEventLogUpdate,
        mockEventLogUpdateMany,
        mockTenantFindMany,
        mockGetAdapter,
        mockWebhookDispatch: vi.fn(),
        mockRetryEnqueue: vi.fn(),
        stellarAdapter,
        algorandAdapter,
    };
});

vi.mock('../src/config/prisma', () => ({
    default: {
        $transaction: mockPrismaTransaction,
        eventLog: {
            update: mockEventLogUpdate,
            updateMany: mockEventLogUpdateMany,
        },
        tenant: {
            findMany: mockTenantFindMany,
        },
    },
}));

vi.mock('../src/services/DLTAdapterFactory', () => ({
    DLTAdapterFactory: {
        getAdapter: mockGetAdapter,
    },
}));

vi.mock('../src/utils/WebhookDispatcher', () => ({
    WebhookDispatcher: {
        dispatch: mockWebhookDispatch,
    },
}));

vi.mock('../src/services/RetryWorker', () => ({
    RetryWorker: {
        enqueue: mockRetryEnqueue,
    },
}));

import { AnchorQueueService } from '../src/services/AnchorQueueService';

describe('AnchorQueueService.processQueue — Stellar routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrismaTransaction.mockImplementation(async (cb: any) => cb({
            $queryRaw: mockQueryRaw,
            eventLog: { updateMany: mockTransactionUpdateMany },
        }));
        mockTransactionUpdateMany.mockResolvedValue({ count: 1 });
        mockEventLogUpdate.mockResolvedValue({});
        mockEventLogUpdateMany.mockResolvedValue({ count: 1 });
        mockWebhookDispatch.mockResolvedValue(undefined);
        mockRetryEnqueue.mockResolvedValue(undefined);
        stellarAdapter.anchorEvent.mockResolvedValue('stellar_tx_001');
        algorandAdapter.anchorEvent.mockResolvedValue('algorand_tx_001');
    });

    it('routes STELLAR tenant events with tenantId anchor options', async () => {
        const event = {
            id: 'evt_stellar_001',
            assetId: 'asset_stellar_001',
            tenantId: 'tenant_stellar',
            signatureHash: 'abc123',
        };
        mockQueryRaw.mockResolvedValue([event]);
        mockTenantFindMany.mockResolvedValue([{ id: 'tenant_stellar', targetChain: 'STELLAR' }]);

        const result = await AnchorQueueService.processQueue();

        expect(mockGetAdapter).toHaveBeenCalledWith('STELLAR');
        expect(stellarAdapter.anchorEvent).toHaveBeenCalledWith('evt_stellar_001', 'abc123', {
            tenantId: 'tenant_stellar',
        });
        expect(mockEventLogUpdate).toHaveBeenCalledWith({
            where: { id: 'evt_stellar_001' },
            data: { dltTxId: 'stellar_tx_001' },
        });
        expect(result).toEqual({
            processed: 1,
            items: [{ id: 'evt_stellar_001', txId: 'stellar_tx_001', success: true }],
        });
    });

    it('keeps ALGORAND routing through targetChain with the same tenant options contract', async () => {
        const event = {
            id: 'evt_algorand_001',
            assetId: 'asset_algorand_001',
            tenantId: 'tenant_algorand',
            signatureHash: 'def456',
        };
        mockQueryRaw.mockResolvedValue([event]);
        mockTenantFindMany.mockResolvedValue([{ id: 'tenant_algorand', targetChain: 'ALGORAND' }]);

        await AnchorQueueService.processQueue();

        expect(mockGetAdapter).toHaveBeenCalledWith('ALGORAND');
        expect(algorandAdapter.anchorEvent).toHaveBeenCalledWith('evt_algorand_001', 'def456', {
            tenantId: 'tenant_algorand',
        });
        expect(mockEventLogUpdate).toHaveBeenCalledWith({
            where: { id: 'evt_algorand_001' },
            data: { dltTxId: 'algorand_tx_001' },
        });
    });

    it('queues failed STELLAR anchors for retry without losing chain context', async () => {
        const event = {
            id: 'evt_stellar_fail',
            assetId: 'asset_stellar_fail',
            tenantId: 'tenant_stellar',
            signatureHash: 'badcafe',
        };
        stellarAdapter.anchorEvent.mockRejectedValue(new Error('stellar network unavailable'));
        mockQueryRaw.mockResolvedValue([event]);
        mockTenantFindMany.mockResolvedValue([{ id: 'tenant_stellar', targetChain: 'STELLAR' }]);

        const result = await AnchorQueueService.processQueue();

        expect(mockRetryEnqueue).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 'tenant_stellar',
            txRef: 'evt_stellar_fail',
            txType: 'ANCHOR',
            chain: 'STELLAR',
        }));
        expect(mockEventLogUpdateMany).toHaveBeenCalledWith({
            where: { id: 'evt_stellar_fail', dltTxId: 'PROCESSING' },
            data: { dltTxId: 'RETRY_QUEUED' },
        });
        expect(result).toEqual({
            processed: 1,
            items: [{ id: 'evt_stellar_fail', success: false, error: 'stellar network unavailable' }],
        });
    });
});
