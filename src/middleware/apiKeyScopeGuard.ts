import { Response, NextFunction } from 'express';
import { ApiKeyScope } from '../security/apiKeyScopes';
import { AuthenticatedRequest } from '../types';

export const requireApiKeyScope = (requiredScope: ApiKeyScope) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const scopes = new Set(req.apiKeyScopes || []);

        if (!req.apiKeyId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required. No API key context found.',
                code: 'API_KEY_REQUIRED',
            });
        }

        if (!scopes.has(requiredScope)) {
            return res.status(403).json({
                success: false,
                error: `API key scope "${requiredScope}" is required for this route.`,
                code: 'API_KEY_SCOPE_DENIED',
            });
        }

        next();
    };
};
