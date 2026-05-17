import crypto from 'crypto';
import prisma from '../../config/prisma';
import {
    PaymentEventStatus,
    PaymentStatus,
    Prisma,
    PurchaseOrderStatus,
    PurchaseOrderType,
    TenantMembershipRole,
} from '@prisma/client';
import { AdminActorContext, DiamondFacets } from '../../types';
import { AdminAuthorizationFacet } from './AdminAuthorizationFacet';
import { CreditLedgerFacet } from './CreditLedgerFacet';

type PaymentIntentInput = {
    tenantId: string;
    purchaseOrderId: string;
    amount: string;
    currency: string;
    metadata?: Prisma.InputJsonValue;
};

type PaymentIntentResult = {
    provider: string;
    providerIntentId: string;
    status: PaymentStatus;
    paymentUrl?: string | null;
    metadata?: Prisma.InputJsonValue;
};

export type ProviderWebhookInput = {
    provider: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
};

type NormalizedProviderEvent = {
    provider: string;
    providerEventId: string;
    eventType: string;
    status: PaymentEventStatus;
    tenantId: string;
    purchaseOrderId?: string | null;
    paymentIntentId?: string | null;
    amount?: string | null;
    currency?: string | null;
};

export interface ReceivablesProvider {
    provider: string;
    createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
    validateWebhook(input: ProviderWebhookInput): boolean;
    normalizePaymentEvent(input: ProviderWebhookInput): NormalizedProviderEvent;
}

type CreateCreditPurchaseParams = {
    credits: number;
    amount: string;
    currency: string;
    provider?: string;
    sku?: string;
    reason?: string;
    metadata?: Prisma.InputJsonValue;
};

type ListPurchaseOrdersParams = {
    page?: number;
    limit?: number;
    status?: PurchaseOrderStatus;
    type?: PurchaseOrderType;
};

type ListPaymentEventsParams = {
    page?: number;
    limit?: number;
    tenantId?: string;
    provider?: string;
    status?: PaymentEventStatus;
};

const DEFAULT_PROVIDER = 'LOCAL_FAKE';

export class ReceivablesProviderFacet {
    static async createCreditPurchaseIntent(
        actor: AdminActorContext,
        tenantId: string,
        params: CreateCreditPurchaseParams
    ) {
        this.ensurePlatformActor(actor);
        const reason = AdminAuthorizationFacet.requireReason(params.reason || actor.reason);
        const credits = normalizePositiveInteger(params.credits, 'credits');
        const amount = normalizeAmountString(params.amount);
        const currency = normalizeCurrency(params.currency);
        const provider = getProvider(params.provider || DEFAULT_PROVIDER);

        await this.ensureTenantExists(tenantId);

        return prisma.$transaction(async (tx) => {
            const order = await tx.purchaseOrder.create({
                data: {
                    tenantId,
                    type: PurchaseOrderType.CREDIT_PACKAGE,
                    status: PurchaseOrderStatus.PENDING_PAYMENT,
                    sku: params.sku,
                    quantity: credits,
                    amount,
                    currency,
                    provider: provider.provider,
                    reason,
                    createdByActorId: actor.actorUserId,
                    metadata: params.metadata ?? {},
                },
            });

            const providerIntent = await provider.createPaymentIntent({
                tenantId,
                purchaseOrderId: order.id,
                amount,
                currency,
                metadata: {
                    purchaseOrderId: order.id,
                    credits,
                    providerCandidate: 'Transfero TBD',
                    facet: DiamondFacets.RECEIVABLES_PROVIDER,
                },
            });

            const intent = await tx.paymentIntent.create({
                data: {
                    tenantId,
                    purchaseOrderId: order.id,
                    provider: provider.provider,
                    providerIntentId: providerIntent.providerIntentId,
                    amount,
                    currency,
                    status: providerIntent.status,
                    paymentUrl: providerIntent.paymentUrl,
                    metadata: providerIntent.metadata ?? {},
                },
            });

            return { purchaseOrder: order, paymentIntent: intent };
        });
    }

    static async recordPaymentWebhook(input: ProviderWebhookInput) {
        const provider = getProvider(input.provider);
        if (!provider.validateWebhook(input)) {
            throw new ReceivablesProviderError('INVALID_WEBHOOK_SIGNATURE', 'Payment webhook signature is invalid.');
        }

        const normalized = provider.normalizePaymentEvent(input);
        const payloadHash = hashPayload(input.body);

        const existing = await prisma.paymentEvent.findUnique({
            where: {
                provider_providerEventId: {
                    provider: normalized.provider,
                    providerEventId: normalized.providerEventId,
                },
            },
        });

        if (existing) {
            return {
                event: existing,
                deduped: true,
                credited: false,
            };
        }

        return prisma.$transaction(async (tx) => {
            const event = await tx.paymentEvent.create({
                data: {
                    tenantId: normalized.tenantId,
                    purchaseOrderId: normalized.purchaseOrderId || undefined,
                    paymentIntentId: normalized.paymentIntentId || undefined,
                    provider: normalized.provider,
                    providerEventId: normalized.providerEventId,
                    eventType: normalized.eventType,
                    status: normalized.status,
                    payloadHash,
                    sanitizedPayload: sanitizePayload(input.body),
                    processedAt: new Date(),
                },
            });

            let credited = false;

            if (normalized.paymentIntentId) {
                await tx.paymentIntent.update({
                    where: { id: normalized.paymentIntentId },
                    data: { status: mapPaymentStatus(normalized.status) },
                });
            }

            if (normalized.purchaseOrderId) {
                await tx.purchaseOrder.update({
                    where: { id: normalized.purchaseOrderId },
                    data: { status: mapPurchaseOrderStatus(normalized.status) },
                });
            }

            if (normalized.status === PaymentEventStatus.CONFIRMED && normalized.purchaseOrderId) {
                const order = await tx.purchaseOrder.findUnique({
                    where: { id: normalized.purchaseOrderId },
                });

                if (
                    order
                    && order.tenantId === normalized.tenantId
                    && order.type === PurchaseOrderType.CREDIT_PACKAGE
                ) {
                    await CreditLedgerFacet.recordPurchasedCredits(tx, {
                        tenantId: order.tenantId,
                        userId: order.userId,
                        purchaseOrderId: order.id,
                        amount: order.quantity,
                        idempotencyKey: `payment-event:${normalized.provider}:${normalized.providerEventId}`,
                        referenceType: 'payment_event',
                        referenceId: event.id,
                        reason: order.reason || 'Compra de créditos confirmada pelo provedor.',
                        metadata: {
                            provider: normalized.provider,
                            providerEventId: normalized.providerEventId,
                            paymentIntentId: normalized.paymentIntentId ?? null,
                            amount: normalized.amount ?? order.amount,
                            currency: normalized.currency ?? order.currency,
                            facet: DiamondFacets.RECEIVABLES_PROVIDER,
                        },
                    });
                    credited = true;
                }
            }

            return {
                event,
                deduped: false,
                credited,
            };
        });
    }

    static async listPurchaseOrders(
        actor: AdminActorContext,
        tenantId: string,
        params: ListPurchaseOrdersParams = {}
    ) {
        this.ensureTenantReaderActor(actor, tenantId);
        await this.ensureTenantExists(tenantId);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where: Prisma.PurchaseOrderWhereInput = {
            tenantId,
            ...(params.status ? { status: params.status } : {}),
            ...(params.type ? { type: params.type } : {}),
        };

        const [orders, total] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
                    paymentEvents: { orderBy: { receivedAt: 'desc' }, take: 1 },
                },
            }),
            prisma.purchaseOrder.count({ where }),
        ]);

        return {
            orders,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    static async listPaymentEvents(
        actor: AdminActorContext,
        params: ListPaymentEventsParams = {}
    ) {
        this.ensurePlatformActor(actor);

        const page = normalizePage(params.page);
        const limit = normalizeLimit(params.limit);
        const skip = (page - 1) * limit;
        const where: Prisma.PaymentEventWhereInput = {
            ...(params.tenantId ? { tenantId: params.tenantId } : {}),
            ...(params.provider ? { provider: params.provider } : {}),
            ...(params.status ? { status: params.status } : {}),
        };

        const [events, total] = await Promise.all([
            prisma.paymentEvent.findMany({
                where,
                skip,
                take: limit,
                orderBy: { receivedAt: 'desc' },
                include: {
                    purchaseOrder: true,
                    paymentIntent: true,
                    tenant: {
                        select: { id: true, name: true, slug: true },
                    },
                },
            }),
            prisma.paymentEvent.count({ where }),
        ]);

        return {
            events,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    private static ensurePlatformActor(actor?: AdminActorContext) {
        if (!actor?.actorUserId) {
            throw new ReceivablesProviderError('ADMIN_ACTOR_REQUIRED', 'Platform admin actor is required.');
        }

        if (actor.role !== TenantMembershipRole.PLATFORM_ADMIN) {
            throw new ReceivablesProviderError('PLATFORM_ADMIN_REQUIRED', 'Quantum Platform Admin permission is required.');
        }
    }

    private static ensureTenantReaderActor(actor: AdminActorContext | undefined, tenantId: string) {
        if (!actor?.actorUserId) {
            throw new ReceivablesProviderError('ADMIN_ACTOR_REQUIRED', 'Admin actor is required.');
        }

        if (actor.role === TenantMembershipRole.PLATFORM_ADMIN) return;

        if (
            actor.role === TenantMembershipRole.TENANT_ADMIN
            && actor.tenantId === tenantId
            && actor.actorTenantId === tenantId
        ) {
            return;
        }

        throw new ReceivablesProviderError('TENANT_SCOPE_FORBIDDEN', 'Tenant Admin can read only its own tenant.');
    }

    private static async ensureTenantExists(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });

        if (!tenant) {
            throw new ReceivablesProviderError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
        }
    }
}

export class FakeLocalReceivablesProvider implements ReceivablesProvider {
    provider = DEFAULT_PROVIDER;

    async createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
        return {
            provider: this.provider,
            providerIntentId: `local_${input.purchaseOrderId}`,
            status: PaymentStatus.PENDING,
            paymentUrl: `https://payments.local/checkout/${input.purchaseOrderId}`,
            metadata: {
                ...asObject(input.metadata),
                providerMode: 'local-fake',
                transferoCandidate: 'TBD',
            },
        };
    }

    validateWebhook(input: ProviderWebhookInput): boolean {
        const received = getHeader(input.headers, 'x-qc-provider-signature');
        if (!received) return false;
        const expected = FakeLocalReceivablesProvider.signPayload(input.body);
        return timingSafeStringEqual(received, expected);
    }

    normalizePaymentEvent(input: ProviderWebhookInput): NormalizedProviderEvent {
        const payload = input.body as Record<string, any>;
        const eventId = normalizeRequiredString(payload.eventId, 'eventId');
        const tenantId = normalizeRequiredString(payload.tenantId, 'tenantId');
        const rawStatus = normalizeRequiredString(payload.status, 'status').toUpperCase();

        return {
            provider: this.provider,
            providerEventId: eventId,
            eventType: typeof payload.eventType === 'string' ? payload.eventType : 'payment.updated',
            status: normalizePaymentEventStatus(rawStatus),
            tenantId,
            purchaseOrderId: typeof payload.purchaseOrderId === 'string' ? payload.purchaseOrderId : null,
            paymentIntentId: typeof payload.paymentIntentId === 'string' ? payload.paymentIntentId : null,
            amount: typeof payload.amount === 'string' ? payload.amount : null,
            currency: typeof payload.currency === 'string' ? payload.currency : null,
        };
    }

    static signPayload(payload: unknown, secret = getFakeProviderSecret()) {
        return crypto
            .createHmac('sha256', secret)
            .update(stableStringify(payload))
            .digest('hex');
    }
}

const PROVIDERS: Record<string, ReceivablesProvider> = {
    [DEFAULT_PROVIDER]: new FakeLocalReceivablesProvider(),
};

function getProvider(provider: string): ReceivablesProvider {
    const normalized = provider.trim().toUpperCase();
    const found = PROVIDERS[normalized];
    if (!found) {
        throw new ReceivablesProviderError('PROVIDER_NOT_CONFIGURED', `Payment provider "${provider}" is not configured.`);
    }
    return found;
}

function normalizePaymentEventStatus(value: string): PaymentEventStatus {
    if (value === 'CONFIRMED' || value === 'APPROVED' || value === 'PAID') {
        return PaymentEventStatus.CONFIRMED;
    }
    if (value === 'FAILED' || value === 'REJECTED') return PaymentEventStatus.FAILED;
    if (value === 'REFUNDED' || value === 'REVERSED') return PaymentEventStatus.REVERSED;
    if (value === 'IGNORED') return PaymentEventStatus.IGNORED;
    return PaymentEventStatus.RECEIVED;
}

function mapPaymentStatus(status: PaymentEventStatus): PaymentStatus {
    if (status === PaymentEventStatus.CONFIRMED) return PaymentStatus.CONFIRMED;
    if (status === PaymentEventStatus.FAILED) return PaymentStatus.FAILED;
    if (status === PaymentEventStatus.REVERSED) return PaymentStatus.REFUNDED;
    return PaymentStatus.PENDING;
}

function mapPurchaseOrderStatus(status: PaymentEventStatus): PurchaseOrderStatus {
    if (status === PaymentEventStatus.CONFIRMED) return PurchaseOrderStatus.PAID;
    if (status === PaymentEventStatus.FAILED) return PurchaseOrderStatus.FAILED;
    if (status === PaymentEventStatus.REVERSED) return PurchaseOrderStatus.REFUNDED;
    return PurchaseOrderStatus.PENDING_PAYMENT;
}

function hashPayload(payload: unknown) {
    return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function sanitizePayload(payload: unknown): Prisma.InputJsonValue {
    if (!payload || typeof payload !== 'object') return {};
    const clone = JSON.parse(JSON.stringify(payload));
    delete clone.secret;
    delete clone.signature;
    delete clone.card;
    return clone;
}

function stableStringify(payload: unknown) {
    return JSON.stringify(payload ?? {});
}

function getHeader(headers: ProviderWebhookInput['headers'], name: string): string | undefined {
    const value = headers[name.toLowerCase()] ?? headers[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
}

function getFakeProviderSecret() {
    return process.env.QC_RECEIVABLES_FAKE_SECRET || 'local-receivables-secret';
}

function timingSafeStringEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ReceivablesProviderError('INVALID_PROVIDER_PAYLOAD', `Payment webhook payload is missing ${field}.`);
    }
    return value.trim();
}

function normalizePositiveInteger(value: number, field: string) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new ReceivablesProviderError('INVALID_AMOUNT', `${field} must be a positive integer.`);
    }
    return value;
}

function normalizeAmountString(value: string) {
    const normalized = value.trim();
    if (!normalized || Number(normalized) <= 0) {
        throw new ReceivablesProviderError('INVALID_AMOUNT', 'Payment amount must be positive.');
    }
    return normalized;
}

function normalizeCurrency(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z]{3,6}$/.test(normalized)) {
        throw new ReceivablesProviderError('INVALID_CURRENCY', 'Payment currency is invalid.');
    }
    return normalized;
}

function asObject(value?: Prisma.InputJsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function normalizePage(value?: number): number {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizeLimit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(Math.floor(value), 100);
}

export class ReceivablesProviderError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'ReceivablesProviderError';
    }
}
