// ═══════════════════════════════════════════════════════════
// DIAMOND PROXY (EIP-2535 STYLE ROUTER)
// Central delegate call point for the Node.js backend.
// Replaces traditional MVC controllers.
// ═══════════════════════════════════════════════════════════

import { Request, Response } from 'express';
import { FacetRegistry } from './FacetRegistry';

export class DiamondProxy {
    /**
     * POST /v1/diamond
     * Universal entry point representing the Diamond Proxy.
     * Expects a JSON body with:
     * { "selector": "facet.method", "args": [...] }
     */
    static async delegateCall(req: Request, res: Response) {
        try {
            const { selector, args } = req.body;

            if (!selector) {
                return res.status(400).json({ success: false, error: 'Selector is required' });
            }

            // Secure the prototype chain to prevent Prototype Pollution / DoS attacks
            if (!Object.prototype.hasOwnProperty.call(FacetRegistry, selector)) {
                return res.status(400).json({ success: false, error: 'Invalid selector provided. Direct prototype access is forbidden.' });
            }

            const targetFacet = FacetRegistry[selector];

            if (!targetFacet) {
                return res.status(404).json({ success: false, error: `Facet function '${selector}' not found in registry.` });
            }

            // RED TEAM HOTFIX 1 (IDOR): Secure Server-Side Context Injection
            // Force the context to derive from secure middleware headers, NOT user payload.
            const secureContext = {
                tenantId: (req as any).tenantId,
                apiKeyId: (req as any).apiKeyId,
                role: (req as any).apiKeyRole
            };

            // Execute the Facet logic headlessly
            // The Facet receives the Server Context FIRST, and the User Payload SECOND
            const result = await targetFacet(secureContext, req.body.payload || {});

            return res.status(200).json({
                success: true,
                data: result,
                meta: {
                    selector,
                    executionMode: 'DELEGATE_CALL',
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error: any) {
            // RED TEAM HOTFIX 3 (Information Disclosure): Sanitize generic errors
            console.error(`[DiamondProxy] Internal System Error executing ${req.body?.selector}:`, error.stack || error);

            if (error.code && error.message) {
                // Known Business Exception
                return res.status(400).json({ success: false, error: error.message, code: error.code });
            }

            return res.status(500).json({
                success: false,
                error: 'Internal Server Error',
                code: 'E500'
            });
        }
    }
}
