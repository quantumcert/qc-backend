import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { TenantUserStatus } from '@prisma/client';
import prisma from '../../config/prisma';
import { TenantUserFacet } from './TenantUserFacet';

const SESSION_TOKEN_PREFIX = 'qcs_';
const DEFAULT_SESSION_TTL_HOURS = 12;
const BCRYPT_ROUNDS = 10;
const INVALID_CREDENTIALS_MESSAGE = 'Email ou senha inválidos.';

type RegisterOpenInput = {
    name: string;
    email: string;
    password: string;
    phone?: string | null;
    ipAddress?: string;
    userAgent?: string;
};

type LoginInput = {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
};

export class TenantUserAuthFacet {
    static async registerOpen(input: RegisterOpenInput) {
        const email = normalizeEmail(input.email);
        const displayName = normalizeRequiredString(input.name, 'Nome completo é obrigatório.');
        const password = normalizeRegistrationPassword(input.password);
        const tenant = await TenantUserFacet.ensureTenantQuantum();

        const existingCredential = await prisma.tenantUserCredential.findFirst({
            where: {
                tenantUser: {
                    tenantId: tenant.id,
                    email,
                },
            },
        });
        if (existingCredential) {
            throw new TenantUserAuthError('EMAIL_ALREADY_REGISTERED', 'Este email já possui acesso cadastrado.');
        }

        const user = await TenantUserFacet.upsertB2CUser({
            tenantId: tenant.id,
            legacyOpenId: email,
            email,
            displayName,
            phone: input.phone,
            status: TenantUserStatus.ACTIVE,
            source: 'open-registration',
        });

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await prisma.tenantUserCredential.upsert({
            where: { tenantUserId: user.id },
            create: {
                tenantUserId: user.id,
                passwordHash,
                passwordUpdatedAt: new Date(),
                failedAttempts: 0,
                lockedUntil: null,
            },
            update: {
                passwordHash,
                passwordUpdatedAt: new Date(),
                failedAttempts: 0,
                lockedUntil: null,
            },
        });

        const session = await this.createSession({
            tenantUserId: user.id,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
        });

        return {
            user,
            sessionToken: session.token,
            expiresAt: session.expiresAt,
        };
    }

    static async login(input: LoginInput) {
        const email = normalizeEmail(input.email);
        const password = normalizeLoginPassword(input.password);
        const tenant = await TenantUserFacet.ensureTenantQuantum();

        const credential = await prisma.tenantUserCredential.findFirst({
            where: {
                tenantUser: {
                    tenantId: tenant.id,
                    email,
                },
            },
            include: {
                tenantUser: {
                    include: {
                        externalIdentities: true,
                        memberships: true,
                        dependents: true,
                    },
                },
            },
        });

        if (!credential || !credential.tenantUser) {
            throw invalidCredentials();
        }
        if (credential.lockedUntil && credential.lockedUntil > new Date()) {
            throw new TenantUserAuthError('ACCOUNT_LOCKED', 'Acesso temporariamente bloqueado. Tente novamente mais tarde.');
        }

        const valid = await bcrypt.compare(password, credential.passwordHash);
        if (!valid) {
            await Promise.resolve(prisma.tenantUserCredential.update({
                where: { tenantUserId: credential.tenantUserId },
                data: { failedAttempts: (credential.failedAttempts ?? 0) + 1 },
            })).catch(() => undefined);
            throw invalidCredentials();
        }

        if (credential.tenantUser.status !== TenantUserStatus.ACTIVE) {
            throw new TenantUserAuthError('TENANT_USER_INACTIVE', 'Usuário sem acesso ativo.');
        }

        await Promise.resolve(prisma.tenantUserCredential.update({
            where: { tenantUserId: credential.tenantUserId },
            data: { failedAttempts: 0, lockedUntil: null },
        })).catch(() => undefined);

        const session = await this.createSession({
            tenantUserId: credential.tenantUserId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
        });

        return {
            user: credential.tenantUser,
            sessionToken: session.token,
            expiresAt: session.expiresAt,
        };
    }

    static async current(sessionToken: string) {
        const tokenHash = hashSessionToken(normalizeSessionToken(sessionToken));
        const session = await prisma.tenantUserSession.findUnique({
            where: { tokenHash },
            include: {
                tenantUser: {
                    include: {
                        externalIdentities: true,
                        memberships: true,
                        dependents: true,
                    },
                },
            },
        });

        if (!session || session.revokedAt || session.expiresAt <= new Date()) {
            throw new TenantUserAuthError('INVALID_SESSION', 'Sessão inválida ou expirada.');
        }
        if (session.tenantUser.status !== TenantUserStatus.ACTIVE) {
            throw new TenantUserAuthError('TENANT_USER_INACTIVE', 'Usuário sem acesso ativo.');
        }

        await Promise.resolve(prisma.tenantUserSession.update({
            where: { tokenHash },
            data: { lastSeenAt: new Date() },
        })).catch(() => undefined);

        return session.tenantUser;
    }

    static async logout(sessionToken: string) {
        const tokenHash = hashSessionToken(normalizeSessionToken(sessionToken));
        return prisma.tenantUserSession.update({
            where: { tokenHash },
            data: { revokedAt: new Date() },
        });
    }

    private static async createSession(params: {
        tenantUserId: string;
        ipAddress?: string;
        userAgent?: string;
    }) {
        const token = `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const tokenHash = hashSessionToken(token);
        const expiresAt = new Date(Date.now() + getSessionTtlMs());

        await prisma.tenantUserSession.create({
            data: {
                tenantUserId: params.tenantUserId,
                tokenHash,
                expiresAt,
                createdIp: params.ipAddress,
                createdUserAgent: params.userAgent,
            },
        });

        return { token, expiresAt };
    }
}

function normalizeEmail(value: string) {
    const email = value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
        throw new TenantUserAuthError('INVALID_EMAIL', 'Email inválido.');
    }
    return email;
}

function normalizeRequiredString(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) {
        throw new TenantUserAuthError('INVALID_INPUT', message);
    }
    return normalized;
}

function normalizeRegistrationPassword(value: string) {
    if (!value || value.length < 8) {
        throw new TenantUserAuthError('INVALID_PASSWORD', 'Senha deve ter pelo menos 8 caracteres.');
    }
    return value;
}

function normalizeLoginPassword(value: string) {
    if (!value) {
        throw invalidCredentials();
    }
    return value;
}

function normalizeSessionToken(value: string) {
    const token = value.trim();
    if (!token.startsWith(SESSION_TOKEN_PREFIX)) {
        throw new TenantUserAuthError('INVALID_SESSION', 'Sessão inválida ou expirada.');
    }
    return token;
}

function hashSessionToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
}

function getSessionTtlMs() {
    const configured = Number(process.env.TENANT_USER_SESSION_TTL_HOURS);
    const hours = Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_SESSION_TTL_HOURS;
    return hours * 60 * 60 * 1000;
}

function invalidCredentials() {
    return new TenantUserAuthError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
}

export class TenantUserAuthError extends Error {
    constructor(
        public code: string,
        message: string,
    ) {
        super(message);
        this.name = 'TenantUserAuthError';
    }
}
