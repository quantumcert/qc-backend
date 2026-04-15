import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────
// SHARED MOCK DB
// ─────────────────────────────────────────────────────────
const { mockAsset, mockAuditLog, mockOwner, mockEventLog, mockBlindContact } = vi.hoisted(() => ({
    mockAsset: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
    },
    mockAuditLog: {
        create: vi.fn(),
    },
    mockOwner: {
        create: vi.fn(),
        findFirst: vi.fn(),
    },
    mockEventLog: {
        create: vi.fn(),
        updateMany: vi.fn(),
        findUnique: vi.fn(),
    },
    mockBlindContact: {
        create: vi.fn(),
    }
}));

vi.mock('../src/config/prisma', () => ({
    default: {
        asset: mockAsset,
        auditLog: mockAuditLog,
        owner: mockOwner,
        eventLog: mockEventLog,
        blindContactLog: mockBlindContact,
        tenantWebhook: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (cb) => {
            return await cb({
                asset: mockAsset,
                auditLog: mockAuditLog,
                owner: mockOwner,
                eventLog: mockEventLog,
                blindContactLog: mockBlindContact
            });
        }),
    }
}));

vi.mock('../src/services/core-facets/BillingFacet', () => ({
    BillingFacet: {
        createPaymentPreference: vi.fn().mockResolvedValue({ initPoint: 'https://pagamento.link' })
    }
}));

vi.mock('../src/services/AnchorQueueService', () => ({
    AnchorQueueService: {
        processQueue: vi.fn().mockResolvedValue({ processed: 0, items: [] }),
    }
}));

// ─────────────────────────────────────────────────────────
// IMPORT NOVO MODELO DIAMOND - PHASE 2 (Facets Reais)
// ─────────────────────────────────────────────────────────
import { AssetRegistryFacet } from '../src/services/core-facets/AssetRegistryFacet';
import { TransferRegistryFacet } from '../src/services/core-facets/TransferRegistryFacet';
import { EventLogFacet } from '../src/services/core-facets/EventLogFacet';
import { PublicProfileFacet } from '../src/services/core-facets/PublicProfileFacet';
import { BlindContactLogFacet } from '../src/services/core-facets/BlindContactLogFacet';

// ─────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────
const SECURE_CONTEXT = { tenantId: 'tenant_001', role: 'ADMIN' };
const ASSET_PAYLOAD = {
    externalId: 'EXT-001',
    deviceId: 'DEV-001',
    metadata: { brand: 'Canyon', model: 'Neuron' },
    publicDataKeys: ['brand'],
    owners: [{ ownerRef: 'owner@qc.com', label: 'Main', sharePercent: 100 }]
};

const BICYCLE = {
    id: 'asset_bike_001', tenantId: 'tenant_001', externalId: 'EXT-001',
    status: 'ACTIVE', publicUrl: 'https://api.domain.com/v1/public/asset/123',
    metadata: { brand: 'Canyon', model: 'Neuron' },
    publicDataKeys: ['brand'],
    createdAt: new Date('2026-02-16'), updatedAt: new Date('2026-02-16'),
    tenant: { customTransferFee: null }
};

// ═══════════════════════════════════════════════════════════
// 1/3. AssetRegistryFacet (substitui ProvisioningFacet e LifecycleFacet)
// ═══════════════════════════════════════════════════════════
describe('FACETA 1/3: AssetRegistryFacet — Criação e Ciclo de Vida', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('✅ Cria Asset com tenant e owners', async () => {
        mockAsset.create.mockResolvedValue(BICYCLE);
        mockAuditLog.create.mockResolvedValue({ id: 'audit_001' });

        const result = await AssetRegistryFacet.createAsset(SECURE_CONTEXT, ASSET_PAYLOAD);

        expect(result).toBeDefined();
        expect(result.status).toBe('ACTIVE');
        expect(mockAsset.create).toHaveBeenCalledOnce();
        expect(mockAuditLog.create).toHaveBeenCalledOnce();
    });

    it('✅ Atualiza status do Asset (State Transition)', async () => {
        mockAsset.updateMany.mockResolvedValue({ count: 1 });
        mockAsset.findUnique.mockResolvedValue({ ...BICYCLE, status: 'RETIRED' });

        const result = await AssetRegistryFacet.updateAsset(SECURE_CONTEXT, { id: BICYCLE.id, status: 'RETIRED' });

        expect(result!.status).toBe('RETIRED');
        expect(mockAsset.updateMany).toHaveBeenCalledOnce();
    });

    it('🚫 Rejeita acesso sem ser ADMIN', async () => {
        await expect(AssetRegistryFacet.createAsset({ tenantId: 'x', role: 'STANDARD' }, ASSET_PAYLOAD))
            .rejects.toThrow(/insufficient privileges/i);
    });
});

// ═══════════════════════════════════════════════════════════
// 2. TransferRegistryFacet (substitui OwnershipFacet)
// ═══════════════════════════════════════════════════════════
describe('FACETA 2: TransferRegistryFacet — Transferência e Billing', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('✅ Inicia transferência com documento CPF (novo comprador — cria Shadow Account)', async () => {
        mockAsset.findUnique.mockResolvedValue(BICYCLE);
        mockOwner.findFirst.mockResolvedValue(null); // no existing owner with this doc
        mockOwner.create.mockResolvedValue({ id: 'owner_shadow_001' });
        mockAsset.update.mockResolvedValue({ ...BICYCLE, status: 'AWAITING_PAYMENT' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_transfer_001' });

        const result = await TransferRegistryFacet.initiateTransfer(
            SECURE_CONTEXT,
            { assetId: BICYCLE.id, buyerDocument: '123.456.789-09', documentType: 'CPF' }
        );

        expect(result.assetId).toBe(BICYCLE.id);
        expect(result.status).toBe('AWAITING_PAYMENT');
        expect(result.paymentLink).toBe('https://pagamento.link');
        expect(result.buyerDocument).toBe('12345678909'); // normalized — mask removed
        expect(result.documentType).toBe('CPF');
        expect(result.buyerOwnerId).toBe('owner_shadow_001');
        expect(mockOwner.findFirst).toHaveBeenCalledOnce();
        expect(mockOwner.create).toHaveBeenCalledOnce();
        expect(mockAsset.update).toHaveBeenCalledOnce();
        expect(mockEventLog.create).toHaveBeenCalledOnce();
    });

    it('✅ Reutiliza Shadow Account existente (mesmo CPF)', async () => {
        mockAsset.findUnique.mockResolvedValue(BICYCLE);
        mockOwner.findFirst.mockResolvedValue({ id: 'owner_existing_001' }); // already exists
        mockAsset.update.mockResolvedValue({ ...BICYCLE, status: 'AWAITING_PAYMENT' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_transfer_002' });

        const result = await TransferRegistryFacet.initiateTransfer(
            SECURE_CONTEXT,
            { assetId: BICYCLE.id, buyerDocument: '12345678909', documentType: 'CPF' }
        );

        expect(result.buyerOwnerId).toBe('owner_existing_001');
        expect(mockOwner.create).not.toHaveBeenCalled(); // no duplicate creation
    });

    it('🚫 Rejeita quando ativo não está ACTIVE', async () => {
        mockAsset.findUnique.mockResolvedValue({ ...BICYCLE, status: 'AWAITING_PAYMENT' });

        await expect(TransferRegistryFacet.initiateTransfer(
            SECURE_CONTEXT,
            { assetId: BICYCLE.id, buyerDocument: '12345678909', documentType: 'CPF' }
        )).rejects.toMatchObject({ code: 'INVALID_ASSET_STATE' });
    });
});

// ═══════════════════════════════════════════════════════════
// 4. EventLogFacet (substitui EventFacet)
// ═══════════════════════════════════════════════════════════
describe('FACETA 4: EventLogFacet — Injeção de Eventos', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('✅ Registra evento autenticado', async () => {
        mockAsset.findUnique.mockResolvedValue({ id: '123', tenantId: 't1' });
        mockEventLog.create.mockResolvedValue({ id: 'evt_001', status: 'APPROVED' });

        const result = await EventLogFacet.recordAuthenticatedEvent({
            assetId: '123', tenantId: 't1', origin: 'API_KEY', payload: { foo: 'bar' }
        });

        expect(result.id).toBe('evt_001');
        expect(result.status).toBe('APPROVED');
        expect(mockEventLog.create).toHaveBeenCalledOnce();
    });

    it('✅ Agenda evento público', async () => {
        mockAsset.findUnique.mockResolvedValue(BICYCLE);
        mockEventLog.create.mockResolvedValue({ id: 'evt_002', status: 'PENDING' });

        const result = await EventLogFacet.suggestPublicEvent({
            assetId: BICYCLE.id, payload: { info: 'public entry' }
        });

        expect(result.status).toBe('PENDING');
        expect(mockEventLog.create).toHaveBeenCalledOnce();
    });
});

// ═══════════════════════════════════════════════════════════
// 5. PublicProfileFacet (substitui QueryFacet)
// ═══════════════════════════════════════════════════════════
describe('FACETA 5: PublicProfileFacet — Consulta LGPD-Safe', () => {
    it('✅ Filtra asset retornando apenas chaves públicas', () => {
        const result = PublicProfileFacet.filterAsset(BICYCLE);

        expect(result).not.toBeNull();
        expect(result?.metadata).toHaveProperty('brand', 'Canyon');
        expect(result?.metadata).not.toHaveProperty('model'); // was not in publicDataKeys
        expect(result).not.toHaveProperty('tenantId'); // LGPD protection
    });
});

// ═══════════════════════════════════════════════════════════
// 6. BlindContactLogFacet (substitui RelayFacet)
// ═══════════════════════════════════════════════════════════
describe('FACETA 6: BlindContactLogFacet — Blind Contact (LGPD)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('✅ Submete contato quando ativo está em ALERT', async () => {
        mockAsset.findUnique.mockResolvedValue({ ...BICYCLE, status: 'ALERT' });
        mockBlindContact.create.mockResolvedValue({ id: 'contact_001' });

        const result = await BlindContactLogFacet.submitContact(
            BICYCLE.id,
            { message: 'Encontrei!' },
            '192.168.0.1'
        );

        expect(result.id).toBe('contact_001');
        expect(mockBlindContact.create).toHaveBeenCalledOnce();
    });

    it('🚫 Rejeita contato se ativo não estiver em ALERT', async () => {
        mockAsset.findUnique.mockResolvedValue({ ...BICYCLE, status: 'ACTIVE' });

        await expect(BlindContactLogFacet.submitContact(BICYCLE.id, { msg: 'oi' }, 'IP'))
            .rejects.toThrow(/ASSET_NOT_IN_ALERT/i);
    });
});
