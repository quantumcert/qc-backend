-- Composite index on Agent(tenantId, isActive) for admin list query pattern
DROP INDEX IF EXISTS "Agent_tenantId_idx";

-- CreateIndex
CREATE INDEX "Agent_tenantId_isActive_idx" ON "Agent"("tenantId", "isActive");
