// ═══════════════════════════════════════════════════════════
// MIDDLEWARE: Agent Signature Verification
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Must run AFTER requireApiKey (depends on req.apiKeyId).
// Validates Falcon-512 payload signature and selector permissions.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import { Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { PostQuantumCrypto } from '../utils/PostQuantumCrypto';
import { AuthenticatedRequest } from '../types';

export const requireAgentSignature = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { apiKeyId, body } = req;
  const { selector, assetId, payload, signature } = body ?? {};

  // 1. Find Agent linked to this ApiKey (tenant-scoped)
  const agent = await prisma.agent.findFirst({
    where: { apiKeyId },
  });

  if (!agent) {
    res.status(403).json({ success: false, error: 'This key is not a machine identity.', code: 'NOT_AN_AGENT' });
    return;
  }

  // 2. Check agent is active
  if (!agent.isActive) {
    res.status(403).json({ success: false, error: 'Agent has been revoked.', code: 'AGENT_REVOKED' });
    return;
  }

  // 3. Verify Falcon-512 signature over the canonical body (selector + assetId + payload)
  const signedBody = JSON.stringify({ selector, assetId, payload });
  const isValid = await PostQuantumCrypto.verifySignatureFalcon512(
    signedBody,
    signature,
    agent.publicKeyFalcon
  );

  if (!isValid) {
    res.status(403).json({ success: false, error: 'Payload signature verification failed.', code: 'INVALID_AGENT_SIGNATURE' });
    return;
  }

  // 4. Check selector is in agent's allowlist
  if (!agent.allowedSelectors.includes(selector)) {
    res.status(403).json({ success: false, error: `Selector "${selector}" is not permitted for this agent.`, code: 'SELECTOR_NOT_ALLOWED' });
    return;
  }

  // 5. Inject agentId into request context for downstream handlers
  req.agentId = agent.id;
  next();
};
