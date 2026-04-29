// ═══════════════════════════════════════════════════════════
// DIAMOND FACET: AgentRegistryFacet
// Architecture: EIP-2535 Faceted Diamond Pattern
//
// Responsibility: Register, revoke, and query machine identities
// (robots / IoT devices) that authenticate via ApiKey + Falcon-512.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/prisma';
import { ApiKeyRole } from '@prisma/client';

interface SecureContext {
  tenantId: string;
  apiKeyId: string;
  role: ApiKeyRole;
}

export class AgentRegistryFacet {

  // ─── REGISTER ────────────────────────────────────────────
  // Creates an Agent + linked ApiKey in one transaction.
  // Returns rawApiKey ONCE — it cannot be recovered later.
  static async register(
    secureContext: SecureContext,
    payload: {
      name: string;
      description?: string;
      publicKeyFalcon: string; // base64-encoded Falcon-512 public key
      allowedSelectors: string[];
    }
  ): Promise<{ agentId: string; rawApiKey: string }> {
    const { tenantId, role } = secureContext;
    const { name, description, publicKeyFalcon, allowedSelectors } = payload;

    if (role !== 'ADMIN') {
      throw new AgentError('INSUFFICIENT_PERMISSIONS', 'Only ADMIN can register agents.');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AgentError('TENANT_NOT_FOUND', `Tenant "${tenantId}" not found.`);
    if (!tenant.isActive) throw new AgentError('TENANT_INACTIVE', 'Tenant is inactive.');

    // Validate publicKeyFalcon is valid base64
    const decoded = Buffer.from(publicKeyFalcon, 'base64');
    if (decoded.toString('base64') !== publicKeyFalcon) {
      throw new AgentError('INVALID_PUBLIC_KEY', 'publicKeyFalcon must be a valid base64 string.');
    }

    // Generate ApiKey material inline (same pattern as ApiKeyManagementFacet)
    const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
    const rawApiKey = `qc_${env}_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawApiKey, 10);
    const keyPrefix = rawApiKey.substring(0, 16);

    const agent = await prisma.$transaction(async (tx) => {
      const newApiKey = await (tx as any).apiKey.create({
        data: {
          tenantId,
          keyHash,
          keyPrefix,
          label: `agent:${name}`,
          role: ApiKeyRole.OPERATOR,
        },
      });

      const newAgent = await (tx as any).agent.create({
        data: {
          tenantId,
          name,
          description,
          publicKeyFalcon,
          allowedSelectors,
          apiKeyId: newApiKey.id,
        },
      });

      await (tx as any).auditLog.create({
        data: {
          tenantId,
          apiKeyPrefix: keyPrefix,
          action: 'AGENT_REGISTERED',
          resourceType: 'AGENT',
          resourceId: newAgent.id,
          metadata: { name, allowedSelectors },
        },
      });

      return newAgent;
    });

    return { agentId: agent.id, rawApiKey };
  }

  // ─── REVOKE ───────────────────────────────────────────────
  // Deactivates Agent + ApiKey atomically.
  static async revoke(
    secureContext: SecureContext,
    payload: { agentId: string }
  ): Promise<{ revoked: true }> {
    const { tenantId } = secureContext;

    const agent = await prisma.agent.findFirst({
      where: { id: payload.agentId, tenantId },
    });

    if (!agent) throw new AgentError('AGENT_NOT_FOUND', 'Agent not found for this tenant.');
    if (!agent.isActive) throw new AgentError('AGENT_ALREADY_REVOKED', 'Agent is already revoked.');

    await prisma.$transaction(async (tx) => {
      await (tx as any).agent.update({
        where: { id: agent.id },
        data: { isActive: false },
      });

      if (agent.apiKeyId) {
        await (tx as any).apiKey.update({
          where: { id: agent.apiKeyId },
          data: { isActive: false, revokedAt: new Date() },
        });
      }
    });

    return { revoked: true };
  }

  // ─── STATUS ───────────────────────────────────────────────
  // Returns agent details scoped to tenant.
  static async status(
    secureContext: SecureContext,
    payload: { agentId: string }
  ) {
    const { tenantId } = secureContext;

    const agent = await prisma.agent.findFirst({
      where: { id: payload.agentId, tenantId },
    });

    if (!agent) throw new AgentError('AGENT_NOT_FOUND', 'Agent not found for this tenant.');

    return agent;
  }
}

export class AgentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AgentError';
  }
}
