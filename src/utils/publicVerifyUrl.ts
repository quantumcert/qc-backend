const DEFAULT_PUBLIC_CONSULTATION_URL_BASE = 'http://localhost:3001';

export function buildPublicVerifyUrl(id: string): string {
    return `${resolvePublicConsultationUrlBase()}/public/verify/${encodeURIComponent(id)}`;
}

export function resolvePublicConsultationUrlBase(): string {
    return normalizeUrlBase(
        readOptionalEnv(process.env.PUBLIC_CONSULTATION_URL_BASE) ||
        readOptionalEnv(process.env.PUBLIC_VERIFY_URL_BASE) ||
        readOptionalEnv(process.env.PUBLIC_APP_URL) ||
        DEFAULT_PUBLIC_CONSULTATION_URL_BASE
    );
}

function normalizeUrlBase(value: string): string {
    return value.trim().replace(/\/+$/, '');
}

function readOptionalEnv(value?: string): string | undefined {
    const normalized = value?.trim();
    if (!normalized || normalized === 'undefined' || normalized === 'null') return undefined;
    return normalized;
}
