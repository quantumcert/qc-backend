import { ApiKeyRole } from '@prisma/client';

export const API_KEY_SCOPE_DEFINITIONS = [
    {
        value: 'assets:read',
        label: 'Ativos: leitura',
        description: 'Consultar e listar Assets tenant-scoped.',
        selectors: ['asset.get', 'asset.list', 'context.routeAssetRead'],
    },
    {
        value: 'assets:write',
        label: 'Ativos: escrita',
        description: 'Criar, editar e gerir ownership de Assets.',
        selectors: ['asset.create', 'asset.update', 'asset.addOwner', 'asset.revokeOwner', 'asset.acceptOwner', 'lifecycle.transition'],
    },
    {
        value: 'events:write',
        label: 'Eventos: escrita',
        description: 'Registrar e revisar eventos autenticados de rastreabilidade.',
        selectors: ['event.recordAuthenticated', 'event.review'],
    },
    {
        value: 'qtags:read',
        label: 'QTAGs: leitura',
        description: 'Consultar status operacional de gravação e commissioning.',
        selectors: ['commissioning.status'],
    },
    {
        value: 'qtags:write',
        label: 'QTAGs: escrita',
        description: 'Registrar devices, validar taps e operar commissioning físico.',
        selectors: ['device.register', 'device.validateTap', 'commissioning.start', 'commissioning.confirm'],
    },
    {
        value: 'transfers:write',
        label: 'Transferências: escrita',
        description: 'Iniciar transferências tenant-scoped.',
        selectors: ['transfer.initiate'],
    },
    {
        value: 'agents:read',
        label: 'Agentes: leitura',
        description: 'Consultar status de agentes M2M.',
        selectors: ['agent.status'],
    },
    {
        value: 'agents:write',
        label: 'Agentes: escrita',
        description: 'Registrar e revogar agentes M2M.',
        selectors: ['agent.register', 'agent.revoke'],
    },
    {
        value: 'escrow:read',
        label: 'Escrow: leitura',
        description: 'Consultar status de escrow.',
        selectors: ['escrow.status'],
    },
    {
        value: 'escrow:write',
        label: 'Escrow: escrita',
        description: 'Criar, liberar e cancelar escrows.',
        selectors: ['escrow.lock', 'escrow.release', 'escrow.cancel'],
    },
    {
        value: 'sustainability:write',
        label: 'Sustentabilidade: escrita',
        description: 'Registrar waste logs e emitir créditos de sustentabilidade.',
        selectors: ['erecycle.recordWaste', 'erecycle.issueCredit'],
    },
    {
        value: 'public:read',
        label: 'Público: leitura',
        description: 'Executar consultas públicas compatíveis com API key.',
        selectors: ['document.verify', 'publicProfile.filter'],
    },
    {
        value: 'public:write',
        label: 'Público: escrita',
        description: 'Receber sugestões públicas e contatos blindados via API key.',
        selectors: ['event.suggestPublic', 'blindContact.submit'],
    },
] as const;

export type ApiKeyScope = typeof API_KEY_SCOPE_DEFINITIONS[number]['value'];

export const API_KEY_SCOPES = API_KEY_SCOPE_DEFINITIONS.map((scope) => scope.value) as ApiKeyScope[];

const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES);

const SELECTOR_SCOPE_MAP = new Map<string, ApiKeyScope>(
    API_KEY_SCOPE_DEFINITIONS.flatMap((scope) =>
        scope.selectors.map((selector) => [selector, scope.value] as const)
    )
);

const DEFAULT_SCOPES_BY_ROLE: Record<ApiKeyRole, ApiKeyScope[]> = {
    [ApiKeyRole.READER]: ['assets:read', 'qtags:read', 'agents:read', 'escrow:read', 'public:read'],
    [ApiKeyRole.OPERATOR]: [
        'assets:read',
        'assets:write',
        'events:write',
        'qtags:read',
        'qtags:write',
        'transfers:write',
        'escrow:read',
        'escrow:write',
        'public:read',
        'public:write',
    ],
    [ApiKeyRole.ADMIN]: [...API_KEY_SCOPES],
};

export function normalizeApiKeyScopes(value: string[] | null | undefined, role: ApiKeyRole): ApiKeyScope[] {
    const normalized = value
        ? Array.from(new Set(value.map((scope) => scope.trim()).filter(Boolean)))
        : [];

    if (normalized.length === 0) {
        return [...DEFAULT_SCOPES_BY_ROLE[role]];
    }

    const invalidScope = normalized.find((scope) => !API_KEY_SCOPE_SET.has(scope));
    if (invalidScope) {
        throw new ApiKeyScopeError(
            'INVALID_API_KEY_SCOPE',
            `API key scope "${invalidScope}" is not part of the canonical scope catalog.`
        );
    }

    return normalized as ApiKeyScope[];
}

export function resolveEffectiveApiKeyScopes(value: string[] | null | undefined, role: ApiKeyRole): ApiKeyScope[] {
    return normalizeApiKeyScopes(value, role);
}

export function resolveScopeForSelector(selector: string): ApiKeyScope {
    const scope = SELECTOR_SCOPE_MAP.get(selector);
    if (!scope) {
        throw new ApiKeyScopeError(
            'API_KEY_SCOPE_UNMAPPED',
            `Selector "${selector}" is not mapped to an API key scope.`
        );
    }

    return scope;
}

export function assertApiKeyCanAccessSelector(selector: string, scopes: string[] | null | undefined) {
    const requiredScope = resolveScopeForSelector(selector);
    const availableScopes = new Set(scopes ?? []);

    if (!availableScopes.has(requiredScope)) {
        throw new ApiKeyScopeError(
            'API_KEY_SCOPE_DENIED',
            `Selector "${selector}" requires scope ${requiredScope}.`
        );
    }
}

export class ApiKeyScopeError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'ApiKeyScopeError';
    }
}
