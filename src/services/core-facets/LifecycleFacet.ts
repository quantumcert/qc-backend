import prisma from '../../config/prisma';
import { AnchorQueueService } from '../AnchorQueueService';
import { AssetAnchoringService } from '../AssetAnchoringService';

interface SecureContext {
    tenantId: string;
    apiKeyId: string;
    role: string;
}

interface LifecyclePayload {
    assetId: string;
    targetState: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'BURNED';
    reason?: string;
}

// Transition matrix: fromState → { allowed targets, allowed roles }
// ARCHIVED e BURNED são estados TERMINAIS (ausentes do mapa = sem saída).
// AWAITING_PAYMENT → ACTIVE é controlado por BillingFacet, NÃO por esta rota.
const TRANSITION_RULES: Record<string, { targets: string[]; roles: string[] }> = {
    DRAFT:    { targets: ['ACTIVE'],                          roles: ['ADMIN', 'OPERATOR'] },
    ACTIVE:   { targets: ['SUSPENDED', 'ARCHIVED', 'BURNED'], roles: ['ADMIN'] },
    SUSPENDED:{ targets: ['ACTIVE'],                          roles: ['ADMIN'] },
};

function makeError(message: string, code: string, httpStatus: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.httpStatus = httpStatus;
    return err;
}

export class LifecycleFacet {
    static async transition(secureContext: SecureContext, payload: LifecyclePayload) {
        const { tenantId, apiKeyId, role } = secureContext;
        const { assetId, targetState, reason } = payload;

        const asset = await prisma.asset.findUnique({
            where: { id: assetId, tenantId },
        });

        if (!asset) {
            throw makeError('Asset not found or access denied', 'ASSET_NOT_FOUND', 404);
        }

        const fromState = asset.status as string;

        if (fromState === 'LOCKED_IN_ESCROW') {
            throw makeError(
                'Asset is locked in escrow. Only EscrowFacet can release it.',
                'ASSET_LOCKED_IN_ESCROW',
                423
            );
        }

        const rules = TRANSITION_RULES[fromState];

        if (!rules || !rules.targets.includes(targetState)) {
            throw makeError(
                `Transition ${fromState} → ${targetState} is not allowed`,
                'STATE_TRANSITION_FORBIDDEN',
                422
            );
        }

        if (!rules.roles.includes(role)) {
            throw makeError(
                `Role ${role} cannot perform transition ${fromState} → ${targetState}`,
                'INSUFFICIENT_ROLE_FOR_TRANSITION',
                403
            );
        }

        const lifecyclePayload = {
            eventType: 'LIFECYCLE_TRANSITION',
            action: 'LIFECYCLE_TRANSITION',
            schemaVersion: 1,
            assetId,
            tenantId,
            fromState,
            toState: targetState,
            reason: reason ?? null,
            transitionedAt: new Date().toISOString(),
        };

        await prisma.$transaction(async (tx) => {
            await tx.asset.update({
                where: { id: assetId },
                data: { status: targetState as any },
            });

            await tx.eventLog.create({
                data: {
                    assetId,
                    tenantId,
                    issuerId: apiKeyId || 'lifecycle.transition',
                    origin: 'LIFECYCLE',
                    status: 'APPROVED',
                    payload: lifecyclePayload,
                    signatureHash: AssetAnchoringService.signatureHash(lifecyclePayload),
                },
            });
        });

        AnchorQueueService.processQueue({ tenantId, assetId }).catch(console.error);

        return { assetId, previousState: fromState, currentState: targetState };
    }
}
