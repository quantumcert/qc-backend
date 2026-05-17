import { describe, expect, it } from 'vitest';
import {
  Prisma,
  TenantMembershipRole,
  TenantStatus,
  TenantUserRole,
} from '@prisma/client';

describe('Phase 4 admin schema foundation', () => {
  it('exposes canonical tenant admin models and roles', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toContain('TenantUser');
    expect(modelNames).toContain('TenantMembership');
    expect(modelNames).toContain('ExternalIdentity');
    expect(modelNames).toContain('AdminAuditLog');
    expect(modelNames).toContain('ApiRequestAudit');
    expect(modelNames).toContain('TenantCommercialProfile');

    expect(TenantStatus.ACTIVE).toBe('ACTIVE');
    expect(TenantUserRole.PLATFORM_ADMIN).toBe('PLATFORM_ADMIN');
    expect(TenantMembershipRole.TENANT_ADMIN).toBe('TENANT_ADMIN');
  });
});
