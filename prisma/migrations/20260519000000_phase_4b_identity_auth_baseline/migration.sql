-- ============================================================
-- Phase 4B production baseline for backend-canonical identity,
-- dashboard auth sessions, registration credits, and migration
-- audit tables.
--
-- The statements are intentionally guarded so the migration can
-- be applied to production databases that already received some
-- of these structures through manual repair or prisma db push.
-- ============================================================

-- Enums
DO $$ BEGIN CREATE TYPE "TenantUserRole" AS ENUM ('PLATFORM_ADMIN', 'TENANT_ADMIN', 'OPERATOR', 'MEMBER', 'DEPENDENT', 'VIEWER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TenantUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TenantMembershipRole" AS ENUM ('PLATFORM_ADMIN', 'TENANT_ADMIN', 'OPERATOR', 'MEMBER', 'VIEWER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TenantMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PurchaseOrderType" AS ENUM ('CREDIT_PACKAGE', 'QTAG_PACKAGE', 'ACTIVATION', 'OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUNDED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'CONFIRMED', 'FAILED', 'REVERSED', 'IGNORED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "CreditLedgerEntryType" AS ENUM ('PURCHASED', 'GRANTED', 'ADJUSTED', 'RESERVED', 'CONSUMED', 'RELEASED', 'REFUNDED', 'REVOKED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "QTagLedgerEntryType" AS ENUM ('PURCHASED', 'GRANTED', 'RESERVED', 'CONSUMED', 'RELEASED', 'REFUNDED', 'ADJUSTED', 'REVOKED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "QTagFulfillmentStatus" AS ENUM ('REQUESTED', 'READY_FOR_ENCODING', 'ENCODING_IN_PROGRESS', 'ENCODING_FAILED', 'QA_PENDING', 'QA_FAILED', 'DISPATCH_READY', 'DISPATCHED', 'DELIVERED', 'ACTIVATED', 'CANCELLED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "MigrationMode" AS ENUM ('DRY_RUN', 'EXECUTE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "MigrationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "MigrationRecordStatus" AS ENUM ('PENDING', 'MIGRATED', 'SKIPPED', 'CONFLICT', 'ERROR'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Values added to enums that predate Phase 4B.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REQUIRES_ACTION';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Tenant commercial profile
CREATE TABLE IF NOT EXISTS "TenantCommercialProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "taxIdType" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "billingOwner" TEXT,
    "commercialPlan" TEXT,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "whiteLabel" JSONB NOT NULL DEFAULT '{}',
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantCommercialProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantCommercialProfile_tenantId_key" ON "TenantCommercialProfile"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "TenantCommercialProfile_taxId_key" ON "TenantCommercialProfile"("taxId");
CREATE INDEX IF NOT EXISTS "TenantCommercialProfile_tenantId_idx" ON "TenantCommercialProfile"("tenantId");
DO $$ BEGIN ALTER TABLE "TenantCommercialProfile" ADD CONSTRAINT "TenantCommercialProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backend-canonical tenant users
CREATE TABLE IF NOT EXISTS "TenantUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "document" TEXT,
    "documentType" TEXT,
    "displayName" TEXT,
    "role" "TenantUserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "TenantUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacyDashboardUserId" TEXT,
    "legacyOpenId" TEXT,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "guardianId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "migratedAt" TIMESTAMP(3),
    CONSTRAINT "TenantUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_legacyDashboardUserId_key" ON "TenantUser"("legacyDashboardUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUser_legacyOpenId_key" ON "TenantUser"("legacyOpenId");
CREATE INDEX IF NOT EXISTS "TenantUser_tenantId_idx" ON "TenantUser"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantUser_tenantId_email_idx" ON "TenantUser"("tenantId", "email");
CREATE INDEX IF NOT EXISTS "TenantUser_tenantId_document_idx" ON "TenantUser"("tenantId", "document");
CREATE INDEX IF NOT EXISTS "TenantUser_tenantId_role_idx" ON "TenantUser"("tenantId", "role");
CREATE INDEX IF NOT EXISTS "TenantUser_legacyDashboardUserId_idx" ON "TenantUser"("legacyDashboardUserId");
CREATE INDEX IF NOT EXISTS "TenantUser_legacyOpenId_idx" ON "TenantUser"("legacyOpenId");
CREATE INDEX IF NOT EXISTS "TenantUser_guardianId_idx" ON "TenantUser"("guardianId");
DO $$ BEGIN ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "TenantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "tenantUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "email" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalIdentity_provider_providerSubject_key" ON "ExternalIdentity"("provider", "providerSubject");
CREATE INDEX IF NOT EXISTS "ExternalIdentity_tenantUserId_idx" ON "ExternalIdentity"("tenantUserId");
CREATE INDEX IF NOT EXISTS "ExternalIdentity_provider_idx" ON "ExternalIdentity"("provider");
DO $$ BEGIN ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenantMembershipRole" NOT NULL DEFAULT 'MEMBER',
    "status" "TenantMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "TenantMembership_tenantId_role_idx" ON "TenantMembership"("tenantId", "role");
CREATE INDEX IF NOT EXISTS "TenantMembership_userId_idx" ON "TenantMembership"("userId");
CREATE INDEX IF NOT EXISTS "TenantMembership_status_idx" ON "TenantMembership"("status");
DO $$ BEGIN ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "TenantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantUserCredential" (
    "id" TEXT NOT NULL,
    "tenantUserId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantUserCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUserCredential_tenantUserId_key" ON "TenantUserCredential"("tenantUserId");
CREATE INDEX IF NOT EXISTS "TenantUserCredential_tenantUserId_idx" ON "TenantUserCredential"("tenantUserId");
CREATE INDEX IF NOT EXISTS "TenantUserCredential_lockedUntil_idx" ON "TenantUserCredential"("lockedUntil");
DO $$ BEGIN ALTER TABLE "TenantUserCredential" ADD CONSTRAINT "TenantUserCredential_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantUserSession" (
    "id" TEXT NOT NULL,
    "tenantUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdIp" TEXT,
    "createdUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantUserSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantUserSession_tokenHash_key" ON "TenantUserSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "TenantUserSession_tenantUserId_idx" ON "TenantUserSession"("tenantUserId");
CREATE INDEX IF NOT EXISTS "TenantUserSession_expiresAt_idx" ON "TenantUserSession"("expiresAt");
CREATE INDEX IF NOT EXISTS "TenantUserSession_revokedAt_idx" ON "TenantUserSession"("revokedAt");
DO $$ BEGIN ALTER TABLE "TenantUserSession" ADD CONSTRAINT "TenantUserSession_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Registration payments and credit ledgers
CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "PurchaseOrderType" NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" TEXT,
    "currency" TEXT,
    "provider" TEXT,
    "providerOrderId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdByActorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_status_idx" ON "PurchaseOrder"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_type_idx" ON "PurchaseOrder"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_provider_providerOrderId_idx" ON "PurchaseOrder"("provider", "providerOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");
DO $$ BEGIN ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "PaymentIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "provider" TEXT NOT NULL,
    "providerIntentId" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PaymentIntent_tenantId_status_idx" ON "PaymentIntent"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "PaymentIntent_purchaseOrderId_idx" ON "PaymentIntent"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PaymentIntent_provider_providerIntentId_idx" ON "PaymentIntent"("provider", "providerIntentId");
DO $$ BEGIN ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "PaymentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "paymentIntentId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payloadHash" TEXT NOT NULL,
    "sanitizedPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_tenantId_receivedAt_idx" ON "PaymentEvent"("tenantId", "receivedAt");
CREATE INDEX IF NOT EXISTS "PaymentEvent_purchaseOrderId_idx" ON "PaymentEvent"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_paymentIntentId_idx" ON "PaymentEvent"("paymentIntentId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_status_idx" ON "PaymentEvent"("status");
DO $$ BEGIN ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "purchaseOrderId" TEXT,
    "entryType" "CreditLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "actorUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedgerEntry_tenantId_idempotencyKey_key" ON "CreditLedgerEntry"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "CreditLedgerEntry_tenantId_createdAt_idx" ON "CreditLedgerEntry"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditLedgerEntry_tenantId_userId_idx" ON "CreditLedgerEntry"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "CreditLedgerEntry_purchaseOrderId_idx" ON "CreditLedgerEntry"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "CreditLedgerEntry_referenceType_referenceId_idx" ON "CreditLedgerEntry"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "CreditLedgerEntry_entryType_idx" ON "CreditLedgerEntry"("entryType");
DO $$ BEGIN ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "QTagFulfillmentOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "assetId" TEXT NOT NULL,
    "status" "QTagFulfillmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "sku" TEXT,
    "shippingRecipient" JSONB,
    "trackingCode" TEXT,
    "carrier" TEXT,
    "notes" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedByActorId" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QTagFulfillmentOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QTagFulfillmentOrder_tenantId_status_idx" ON "QTagFulfillmentOrder"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "QTagFulfillmentOrder_tenantId_assetId_idx" ON "QTagFulfillmentOrder"("tenantId", "assetId");
CREATE INDEX IF NOT EXISTS "QTagFulfillmentOrder_userId_idx" ON "QTagFulfillmentOrder"("userId");
CREATE INDEX IF NOT EXISTS "QTagFulfillmentOrder_createdAt_idx" ON "QTagFulfillmentOrder"("createdAt");
DO $$ BEGIN ALTER TABLE "QTagFulfillmentOrder" ADD CONSTRAINT "QTagFulfillmentOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "QTagFulfillmentOrder" ADD CONSTRAINT "QTagFulfillmentOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "QTagLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "purchaseOrderId" TEXT,
    "fulfillmentOrderId" TEXT,
    "entryType" "QTagLedgerEntryType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "actorUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QTagLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "QTagLedgerEntry_tenantId_idempotencyKey_key" ON "QTagLedgerEntry"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "QTagLedgerEntry_tenantId_createdAt_idx" ON "QTagLedgerEntry"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "QTagLedgerEntry_tenantId_userId_idx" ON "QTagLedgerEntry"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "QTagLedgerEntry_purchaseOrderId_idx" ON "QTagLedgerEntry"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "QTagLedgerEntry_fulfillmentOrderId_idx" ON "QTagLedgerEntry"("fulfillmentOrderId");
CREATE INDEX IF NOT EXISTS "QTagLedgerEntry_referenceType_referenceId_idx" ON "QTagLedgerEntry"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "QTagLedgerEntry_entryType_idx" ON "QTagLedgerEntry"("entryType");
DO $$ BEGIN ALTER TABLE "QTagLedgerEntry" ADD CONSTRAINT "QTagLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "QTagLedgerEntry" ADD CONSTRAINT "QTagLedgerEntry_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "QTagLedgerEntry" ADD CONSTRAINT "QTagLedgerEntry_fulfillmentOrderId_fkey" FOREIGN KEY ("fulfillmentOrderId") REFERENCES "QTagFulfillmentOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill audit and checkpointing
CREATE TABLE IF NOT EXISTS "MigrationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" "MigrationMode" NOT NULL,
    "source" TEXT NOT NULL,
    "status" "MigrationRunStatus" NOT NULL DEFAULT 'PENDING',
    "batchSize" INTEGER,
    "checksum" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdByActorId" TEXT,
    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MigrationRun_tenantId_status_idx" ON "MigrationRun"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "MigrationRun_source_idx" ON "MigrationRun"("source");
CREATE INDEX IF NOT EXISTS "MigrationRun_startedAt_idx" ON "MigrationRun"("startedAt");
DO $$ BEGIN ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "MigrationCheckpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "migrationRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "lastSourceId" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "status" "MigrationRunStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MigrationCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MigrationCheckpoint_migrationRunId_batchKey_key" ON "MigrationCheckpoint"("migrationRunId", "batchKey");
CREATE INDEX IF NOT EXISTS "MigrationCheckpoint_tenantId_source_idx" ON "MigrationCheckpoint"("tenantId", "source");
CREATE INDEX IF NOT EXISTS "MigrationCheckpoint_status_idx" ON "MigrationCheckpoint"("status");
DO $$ BEGIN ALTER TABLE "MigrationCheckpoint" ADD CONSTRAINT "MigrationCheckpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "MigrationCheckpoint" ADD CONSTRAINT "MigrationCheckpoint_migrationRunId_fkey" FOREIGN KEY ("migrationRunId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "MigrationRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "migrationRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "status" "MigrationRecordStatus" NOT NULL DEFAULT 'PENDING',
    "checksum" TEXT,
    "error" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MigrationRecord_migrationRunId_source_sourceId_key" ON "MigrationRecord"("migrationRunId", "source", "sourceId");
CREATE INDEX IF NOT EXISTS "MigrationRecord_tenantId_source_idx" ON "MigrationRecord"("tenantId", "source");
CREATE INDEX IF NOT EXISTS "MigrationRecord_status_idx" ON "MigrationRecord"("status");
CREATE INDEX IF NOT EXISTS "MigrationRecord_targetType_targetId_idx" ON "MigrationRecord"("targetType", "targetId");
DO $$ BEGIN ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_migrationRunId_fkey" FOREIGN KEY ("migrationRunId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
