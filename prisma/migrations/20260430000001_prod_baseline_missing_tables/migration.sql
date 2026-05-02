-- ============================================================
-- PROD BASELINE: Creates all tables that were historically
-- created via `prisma db push` without formal migrations.
-- All statements use IF NOT EXISTS / exception guards so this
-- is safe to run on any DB state (fresh or existing).
-- ============================================================

-- Enums
DO $$ BEGIN CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PROFESSIONAL', 'ENTERPRISE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ApiKeyRole" AS ENUM ('ADMIN', 'OPERATOR', 'READER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RateLimitWindow" AS ENUM ('MINUTE', 'DAILY'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TapVerdict" AS ENUM ('VALID', 'REPLAY_BLOCKED', 'CMAC_INVALID', 'DEVICE_INACTIVE', 'DEVICE_NOT_FOUND', 'RELAY_ATTACK'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PENDING_FUNDS'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BURNED', 'AWAITING_PAYMENT', 'LOCKED_IN_ESCROW', 'ALERT', 'INACTIVE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "EscrowStatus" AS ENUM ('PENDING', 'ACTIVE', 'PROCESSING', 'RELEASED', 'CANCELLED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PendingTxStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'SUCCESS', 'DLQ'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PendingTxType" AS ENUM ('ANCHOR', 'ESCROW_CREATE', 'ESCROW_RELEASE', 'ESCROW_CANCEL', 'TRANSFER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "EncodingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum values that may have been added later
ALTER TYPE "TapVerdict" ADD VALUE IF NOT EXISTS 'RELAY_ATTACK';
ALTER TYPE "EscrowStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'LOCKED_IN_ESCROW';
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'ALERT';
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

-- RateLimitCounter
CREATE TABLE IF NOT EXISTS "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "windowType" "RateLimitWindow" NOT NULL,
    "windowKey" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RateLimitCounter_tenantId_windowType_idx" ON "RateLimitCounter"("tenantId", "windowType");
CREATE INDEX IF NOT EXISTS "RateLimitCounter_windowKey_idx" ON "RateLimitCounter"("windowKey");
CREATE UNIQUE INDEX IF NOT EXISTS "RateLimitCounter_tenantId_windowType_windowKey_key" ON "RateLimitCounter"("tenantId", "windowType", "windowKey");
DO $$ BEGIN ALTER TABLE "RateLimitCounter" ADD CONSTRAINT "RateLimitCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "apiKeyPrefix" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_timestamp_idx" ON "AuditLog"("tenantId", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- Owner
CREATE TABLE IF NOT EXISTS "Owner" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ownerRef" TEXT NOT NULL,
    "document" TEXT,
    "documentType" TEXT,
    "label" TEXT,
    "sharePercent" DECIMAL(6,2),
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Owner_assetId_idx" ON "Owner"("assetId");
CREATE INDEX IF NOT EXISTS "Owner_ownerRef_idx" ON "Owner"("ownerRef");
CREATE INDEX IF NOT EXISTS "Owner_assetId_document_idx" ON "Owner"("assetId", "document");
CREATE UNIQUE INDEX IF NOT EXISTS "Owner_assetId_ownerRef_key" ON "Owner"("assetId", "ownerRef");
DO $$ BEGIN ALTER TABLE "Owner" ADD CONSTRAINT "Owner_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Device
CREATE TABLE IF NOT EXISTS "Device" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lastCounter" INTEGER NOT NULL DEFAULT 0,
    "lastTapAt" TIMESTAMP(3),
    "totalTaps" INTEGER NOT NULL DEFAULT 0,
    "lastTapIp" TEXT,
    "lastLat" DOUBLE PRECISION,
    "lastLon" DOUBLE PRECISION,
    "sdmMacKeyId" TEXT,
    "sdmEncKeyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "masterKey" JSONB,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Device_uid_key" ON "Device"("uid");
CREATE INDEX IF NOT EXISTS "Device_uid_idx" ON "Device"("uid");
CREATE INDEX IF NOT EXISTS "Device_tenantId_idx" ON "Device"("tenantId");
CREATE INDEX IF NOT EXISTS "Device_isActive_idx" ON "Device"("isActive");

-- DeviceTapLog
CREATE TABLE IF NOT EXISTS "DeviceTapLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "counterValue" INTEGER NOT NULL,
    "cmacReceived" TEXT NOT NULL,
    "cmacValid" BOOLEAN NOT NULL,
    "verdict" "TapVerdict" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "rawUrl" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceTapLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeviceTapLog_deviceId_timestamp_idx" ON "DeviceTapLog"("deviceId", "timestamp");
CREATE INDEX IF NOT EXISTS "DeviceTapLog_verdict_idx" ON "DeviceTapLog"("verdict");
CREATE INDEX IF NOT EXISTS "DeviceTapLog_timestamp_idx" ON "DeviceTapLog"("timestamp");
DO $$ BEGIN ALTER TABLE "DeviceTapLog" ADD CONSTRAINT "DeviceTapLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- EventLog
CREATE TABLE IF NOT EXISTS "EventLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "issuerId" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "signatureHash" TEXT,
    "dltTxId" TEXT,
    "documentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EventLog_assetId_idx" ON "EventLog"("assetId");
CREATE INDEX IF NOT EXISTS "EventLog_tenantId_idx" ON "EventLog"("tenantId");
CREATE INDEX IF NOT EXISTS "EventLog_status_idx" ON "EventLog"("status");
CREATE INDEX IF NOT EXISTS "EventLog_createdAt_idx" ON "EventLog"("createdAt");
CREATE INDEX IF NOT EXISTS "EventLog_documentHash_idx" ON "EventLog"("documentHash");
CREATE INDEX IF NOT EXISTS "EventLog_status_dltTxId_idx" ON "EventLog"("status", "dltTxId");
DO $$ BEGIN ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- BlindContactLog
CREATE TABLE IF NOT EXISTS "BlindContactLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactData" JSONB NOT NULL,
    "originIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlindContactLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BlindContactLog_assetId_idx" ON "BlindContactLog"("assetId");
CREATE INDEX IF NOT EXISTS "BlindContactLog_tenantId_idx" ON "BlindContactLog"("tenantId");
CREATE INDEX IF NOT EXISTS "BlindContactLog_createdAt_idx" ON "BlindContactLog"("createdAt");
DO $$ BEGIN ALTER TABLE "BlindContactLog" ADD CONSTRAINT "BlindContactLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "BlindContactLog" ADD CONSTRAINT "BlindContactLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- UserWallet
CREATE TABLE IF NOT EXISTS "UserWallet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "pqcPublicKey" TEXT,
    "accountIndex" INTEGER NOT NULL DEFAULT 0,
    "encryptedPrivateKey" TEXT,
    "keyWrapVersion" INTEGER NOT NULL DEFAULT 1,
    "wrappedAt" TIMESTAMP(3),
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UserWallet_tenantId_idx" ON "UserWallet"("tenantId");
CREATE INDEX IF NOT EXISTS "UserWallet_address_idx" ON "UserWallet"("address");
CREATE INDEX IF NOT EXISTS "UserWallet_chain_idx" ON "UserWallet"("chain");
CREATE UNIQUE INDEX IF NOT EXISTS "UserWallet_tenantId_address_chain_key" ON "UserWallet"("tenantId", "address", "chain");
DO $$ BEGIN ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Deposit
CREATE TABLE IF NOT EXISTS "Deposit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "assetAddress" TEXT,
    "chain" TEXT NOT NULL,
    "blockNumber" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "requiredConfirmations" INTEGER NOT NULL DEFAULT 12,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Deposit_txHash_key" ON "Deposit"("txHash");
CREATE INDEX IF NOT EXISTS "Deposit_tenantId_idx" ON "Deposit"("tenantId");
CREATE INDEX IF NOT EXISTS "Deposit_walletId_idx" ON "Deposit"("walletId");
CREATE INDEX IF NOT EXISTS "Deposit_txHash_idx" ON "Deposit"("txHash");
CREATE INDEX IF NOT EXISTS "Deposit_status_idx" ON "Deposit"("status");
CREATE INDEX IF NOT EXISTS "Deposit_chain_idx" ON "Deposit"("chain");
CREATE INDEX IF NOT EXISTS "Deposit_detectedAt_idx" ON "Deposit"("detectedAt");
DO $$ BEGIN ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "UserWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MasterKey
CREATE TABLE IF NOT EXISTS "MasterKey" (
    "id" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "publicKeyHash" TEXT NOT NULL,
    "keyWrapVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "MasterKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MasterKey_publicKeyHash_key" ON "MasterKey"("publicKeyHash");
CREATE INDEX IF NOT EXISTS "MasterKey_keyType_idx" ON "MasterKey"("keyType");
CREATE INDEX IF NOT EXISTS "MasterKey_isActive_idx" ON "MasterKey"("isActive");

-- PanicLog
CREATE TABLE IF NOT EXISTS "PanicLog" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "chainScope" TEXT NOT NULL DEFAULT 'ALL',
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "metadata" JSONB,
    CONSTRAINT "PanicLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PanicLog_triggeredAt_idx" ON "PanicLog"("triggeredAt");
CREATE INDEX IF NOT EXISTS "PanicLog_isResolved_idx" ON "PanicLog"("isResolved");
CREATE INDEX IF NOT EXISTS "PanicLog_chainScope_idx" ON "PanicLog"("chainScope");

-- Escrow
CREATE TABLE IF NOT EXISTS "Escrow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "assetId" TEXT,
    "chain" TEXT NOT NULL,
    "chainTxId" TEXT,
    "sender" TEXT NOT NULL,
    "receiver" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "assetAddress" TEXT,
    "unlockTimestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'PENDING',
    "releaseMode" TEXT NOT NULL DEFAULT 'AUTO',
    "releaseConfirmedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Escrow_escrowId_key" ON "Escrow"("escrowId");
CREATE INDEX IF NOT EXISTS "Escrow_tenantId_idx" ON "Escrow"("tenantId");
CREATE INDEX IF NOT EXISTS "Escrow_chain_idx" ON "Escrow"("chain");
CREATE INDEX IF NOT EXISTS "Escrow_status_idx" ON "Escrow"("status");
CREATE INDEX IF NOT EXISTS "Escrow_escrowId_idx" ON "Escrow"("escrowId");
CREATE INDEX IF NOT EXISTS "Escrow_createdAt_idx" ON "Escrow"("createdAt");
DO $$ BEGIN ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ChainTransaction
CREATE TABLE IF NOT EXISTS "ChainTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "txRef" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "amount" TEXT,
    "assetAddress" TEXT,
    "chainTxId" TEXT,
    "blockNumber" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChainTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChainTransaction_tenantId_idx" ON "ChainTransaction"("tenantId");
CREATE INDEX IF NOT EXISTS "ChainTransaction_chain_idx" ON "ChainTransaction"("chain");
CREATE INDEX IF NOT EXISTS "ChainTransaction_txRef_idx" ON "ChainTransaction"("txRef");
CREATE INDEX IF NOT EXISTS "ChainTransaction_status_idx" ON "ChainTransaction"("status");
CREATE INDEX IF NOT EXISTS "ChainTransaction_createdAt_idx" ON "ChainTransaction"("createdAt");
DO $$ BEGIN ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- PendingTransaction
CREATE TABLE IF NOT EXISTS "PendingTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "txRef" TEXT NOT NULL,
    "txType" "PendingTxType" NOT NULL,
    "chain" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PendingTxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isDlq" BOOLEAN NOT NULL DEFAULT false,
    "dlqReason" TEXT,
    "dlqAt" TIMESTAMP(3),
    "chainTxId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PendingTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PendingTransaction_tenantId_idx" ON "PendingTransaction"("tenantId");
CREATE INDEX IF NOT EXISTS "PendingTransaction_status_idx" ON "PendingTransaction"("status");
CREATE INDEX IF NOT EXISTS "PendingTransaction_chain_idx" ON "PendingTransaction"("chain");
CREATE INDEX IF NOT EXISTS "PendingTransaction_txType_idx" ON "PendingTransaction"("txType");
CREATE INDEX IF NOT EXISTS "PendingTransaction_nextRetryAt_idx" ON "PendingTransaction"("nextRetryAt");
CREATE INDEX IF NOT EXISTS "PendingTransaction_isDlq_idx" ON "PendingTransaction"("isDlq");
CREATE INDEX IF NOT EXISTS "PendingTransaction_status_nextRetryAt_idx" ON "PendingTransaction"("status", "nextRetryAt");
DO $$ BEGIN ALTER TABLE "PendingTransaction" ADD CONSTRAINT "PendingTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- TagScanLog
CREATE TABLE IF NOT EXISTS "TagScanLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "geoLocation" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TagScanLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TagScanLog_assetId_idx" ON "TagScanLog"("assetId");
CREATE INDEX IF NOT EXISTS "TagScanLog_timestamp_idx" ON "TagScanLog"("timestamp");
CREATE INDEX IF NOT EXISTS "TagScanLog_isValid_idx" ON "TagScanLog"("isValid");
DO $$ BEGIN ALTER TABLE "TagScanLog" ADD CONSTRAINT "TagScanLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- TenantWebhook
CREATE TABLE IF NOT EXISTS "TenantWebhook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantWebhook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TenantWebhook_tenantId_idx" ON "TenantWebhook"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantWebhook_isActive_idx" ON "TenantWebhook"("isActive");
DO $$ BEGIN ALTER TABLE "TenantWebhook" ADD CONSTRAINT "TenantWebhook_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- WebhookInbox
CREATE TABLE IF NOT EXISTS "WebhookInbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WebhookInbox_status_receivedAt_idx" ON "WebhookInbox"("status", "receivedAt");

-- Agent composite index (safe — Agent already exists at this point)
DROP INDEX IF EXISTS "Agent_tenantId_idx";
CREATE INDEX IF NOT EXISTS "Agent_tenantId_isActive_idx" ON "Agent"("tenantId", "isActive");

-- Asset foreign key to Device (may not exist if Device was created after Asset)
DO $$ BEGIN ALTER TABLE "Asset" ADD CONSTRAINT "Asset_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
