import { CreditLedgerEntryType, Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { CreditLedgerFacet } from './CreditLedgerFacet';

type RegistrationCreditParams = {
    tenantId: string;
    userId: string;
    idempotencyKey: string;
    referenceId?: string;
    reason?: string;
    metadata?: Prisma.InputJsonValue;
};

type RegistrationBonusGrantParams = {
    tenantId: string;
    userId: string;
    email?: string | null;
    metadata?: Prisma.InputJsonValue;
};

const DEPENDENT_REFERENCE_TYPE = 'DEPENDENT_REGISTRATION';
const ASSET_REFERENCE_TYPE = 'ASSET_REGISTRATION';
const REGISTRATION_BONUS_REFERENCE_TYPE = 'REGISTRATION_BONUS';
const INITIAL_REGISTRATION_BONUS_CREDITS = 5;
const LEDGER_SOURCE = 'qc-backend-credit-ledger';

export class RegistrationCreditFacet {
    static async getSummary(tenantId: string, userId: string) {
        const entries = await prisma.creditLedgerEntry.findMany({
            where: { tenantId, userId },
            select: {
                entryType: true,
                amount: true,
                availableDelta: true,
                reservedDelta: true,
            },
        });

        const totals = entries.reduce((acc, entry) => {
            acc.creditsBalance += entry.availableDelta;
            acc.reserved += entry.reservedDelta;
            if (entry.entryType === CreditLedgerEntryType.CONSUMED) acc.consumed += entry.amount;
            return acc;
        }, {
            creditsBalance: 0,
            reserved: 0,
            consumed: 0,
        });

        return {
            tenantId,
            userId,
            creditsBalance: Math.max(0, totals.creditsBalance),
            reserved: Math.max(0, totals.reserved),
            consumed: totals.consumed,
            ledgerSource: LEDGER_SOURCE,
            balance: 0,
        };
    }

    static async consumeForDependentRegistration(params: RegistrationCreditParams) {
        await this.reserveForDependentRegistration(params);
        await this.consumeReservedForDependentRegistration({
            ...params,
            idempotencyKey: `${params.idempotencyKey}:consume`,
        });
        return this.getSummary(params.tenantId, params.userId);
    }

    static async consumeForAssetRegistration(params: RegistrationCreditParams) {
        await this.reserveForAssetRegistration(params);
        await this.consumeReservedForAssetRegistration({
            ...params,
            idempotencyKey: `${params.idempotencyKey}:consume`,
        });
        return this.getSummary(params.tenantId, params.userId);
    }

    static async grantInitialRegistrationBonus(params: RegistrationBonusGrantParams) {
        const idempotencyKey = `registration-bonus:${params.userId}`;

        return prisma.$transaction(async (tx) => {
            const existing = await tx.creditLedgerEntry.findUnique({
                where: {
                    tenantId_idempotencyKey: {
                        tenantId: params.tenantId,
                        idempotencyKey,
                    },
                },
            });
            if (existing) return existing;

            return tx.creditLedgerEntry.create({
                data: {
                    tenantId: params.tenantId,
                    userId: params.userId,
                    entryType: CreditLedgerEntryType.GRANTED,
                    amount: INITIAL_REGISTRATION_BONUS_CREDITS,
                    availableDelta: INITIAL_REGISTRATION_BONUS_CREDITS,
                    reservedDelta: 0,
                    idempotencyKey,
                    referenceType: REGISTRATION_BONUS_REFERENCE_TYPE,
                    referenceId: params.userId,
                    reason: 'initial registration bonus',
                    metadata: {
                        source: 'open-registration',
                        ...(params.email ? { email: params.email } : {}),
                        ...((params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata))
                            ? params.metadata
                            : {}),
                    },
                },
            });
        });
    }

    static reserveForDependentRegistration(params: RegistrationCreditParams) {
        return CreditLedgerFacet.reserveCredits(buildLedgerParams(params, DEPENDENT_REFERENCE_TYPE));
    }

    static consumeReservedForDependentRegistration(params: RegistrationCreditParams) {
        return CreditLedgerFacet.consumeReservedCredits(buildLedgerParams(params, DEPENDENT_REFERENCE_TYPE));
    }

    static releaseForDependentRegistration(params: RegistrationCreditParams) {
        return CreditLedgerFacet.releaseReservedCredits(buildLedgerParams(params, DEPENDENT_REFERENCE_TYPE));
    }

    static reserveForAssetRegistration(params: RegistrationCreditParams) {
        return CreditLedgerFacet.reserveCredits(buildLedgerParams(params, ASSET_REFERENCE_TYPE));
    }

    static consumeReservedForAssetRegistration(params: RegistrationCreditParams) {
        return CreditLedgerFacet.consumeReservedCredits(buildLedgerParams(params, ASSET_REFERENCE_TYPE));
    }

    static releaseForAssetRegistration(params: RegistrationCreditParams) {
        return CreditLedgerFacet.releaseReservedCredits(buildLedgerParams(params, ASSET_REFERENCE_TYPE));
    }
}

function buildLedgerParams(params: RegistrationCreditParams, referenceType: string) {
    return {
        tenantId: params.tenantId,
        userId: params.userId,
        amount: 1,
        idempotencyKey: params.idempotencyKey,
        referenceType,
        referenceId: params.referenceId,
        reason: params.reason ?? 'registration credit consumption',
        metadata: params.metadata,
    };
}
