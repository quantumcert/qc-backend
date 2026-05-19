import { Request, Response } from 'express';
import { z } from 'zod';
import {
    TenantUserAuthError,
    TenantUserAuthFacet,
} from '../services/core-facets/TenantUserAuthFacet';
import { DiamondFacets } from '../types';

const optionalStringSchema = z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().trim().min(1).nullable().optional()
);

const registerSchema = z.object({
    name: z.string().trim().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    phone: optionalStringSchema,
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export class TenantUserAuthController {
    static async register(req: Request, res: Response) {
        try {
            const payload = registerSchema.parse(req.body);
            const result = await TenantUserAuthFacet.registerOpen({
                ...payload,
                ipAddress: req.ip,
                userAgent: getUserAgent(req),
            });

            return res.status(201).json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAuthError(error, res, '[TenantUserAuthController.register]');
        }
    }

    static async login(req: Request, res: Response) {
        try {
            const payload = loginSchema.parse(req.body);
            const result = await TenantUserAuthFacet.login({
                ...payload,
                ipAddress: req.ip,
                userAgent: getUserAgent(req),
            });

            return res.json({
                success: true,
                data: result,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAuthError(error, res, '[TenantUserAuthController.login]');
        }
    }

    static async me(req: Request, res: Response) {
        try {
            const user = await TenantUserAuthFacet.current(extractBearerToken(req));
            return res.json({
                success: true,
                data: user,
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAuthError(error, res, '[TenantUserAuthController.me]');
        }
    }

    static async logout(req: Request, res: Response) {
        try {
            await TenantUserAuthFacet.logout(extractBearerToken(req));
            return res.json({
                success: true,
                data: { success: true },
                meta: buildMeta(),
            });
        } catch (error) {
            return respondWithAuthError(error, res, '[TenantUserAuthController.logout]');
        }
    }
}

function extractBearerToken(req: Request) {
    const authorization = req.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
        throw new TenantUserAuthError('INVALID_SESSION', 'Sessão inválida ou expirada.');
    }

    return match[1].trim();
}

function getUserAgent(req: Request) {
    const userAgent = req.headers['user-agent'];
    return Array.isArray(userAgent) ? userAgent.join(' ') : userAgent;
}

function buildMeta() {
    return {
        timestamp: new Date().toISOString(),
        facet: DiamondFacets.TENANT_USER,
    };
}

function respondWithAuthError(error: unknown, res: Response, logPrefix: string) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({
            success: false,
            error: 'Validation error.',
            details: error.errors,
        });
    }

    if (error instanceof TenantUserAuthError) {
        const statusMap: Record<string, number> = {
            INVALID_EMAIL: 400,
            INVALID_INPUT: 400,
            INVALID_PASSWORD: 400,
            EMAIL_ALREADY_REGISTERED: 409,
            INVALID_CREDENTIALS: 401,
            INVALID_SESSION: 401,
            TENANT_USER_INACTIVE: 403,
            ACCOUNT_LOCKED: 423,
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
