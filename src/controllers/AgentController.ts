// ═══════════════════════════════════════════════════════════
// CONTROLLER: Agent Event Handler
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Handles POST /api/v1/agent/event.
// requireApiKey + requireAgentSignature run before this.
// Executes the Facet directly via FacetRegistry — no HTTP round-trip.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response } from 'express';
import { FacetRegistry } from '../diamond/FacetRegistry';
import { AuthenticatedRequest } from '../types';

export class AgentController {
  static async handleEvent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { selector, assetId, payload } = req.body;

    if (!Object.prototype.hasOwnProperty.call(FacetRegistry, selector)) {
      res.status(400).json({ success: false, error: 'Unknown selector.', code: 'UNKNOWN_SELECTOR' });
      return;
    }

    const facet = FacetRegistry[selector];

    // secureContext includes agentId so Facets can record machine provenance
    const secureContext = {
      tenantId: req.tenantId!,
      apiKeyId: req.apiKeyId!,
      role: req.apiKeyRole!,
      agentId: req.agentId,
    };

    try {
      const result = await facet(secureContext, { assetId, ...payload });
      res.status(200).json({
        success: true,
        data: result,
        meta: { selector, executionMode: 'AGENT_EVENT', timestamp: new Date().toISOString() },
      });
    } catch (error: any) {
      console.error(`[AgentController] Error executing ${selector}:`, error);
      if (error.code && error.message) {
        res.status(400).json({ success: false, error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ success: false, error: 'Internal Server Error', code: 'E500' });
    }
  }
}
