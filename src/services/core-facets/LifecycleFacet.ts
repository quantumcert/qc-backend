import prisma from '../../config/prisma';

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

        await prisma.asset.update({
            where: { id: assetId },
            data: { status: targetState as any },
        });

        await prisma.eventLog.create({
            data: {
                assetId,
                tenantId,
                origin: apiKeyId,
                status: 'APPROVED',
                payload: {
                    action: 'LIFECYCLE_TRANSITION',
                    fromState,
                    toState: targetState,
                    reason: reason ?? null,
                },
            },
        });

        return { assetId, previousState: fromState, currentState: targetState };
    }
}
