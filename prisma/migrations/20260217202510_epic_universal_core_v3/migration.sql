-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('ORIGINATOR', 'DISTRIBUTOR', 'GENERIC');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'BILLED', 'PAID', 'WAIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SystemState" AS ENUM ('IN_TRANSIT', 'ACTIVE', 'SUSPENDED', 'ALERT', 'LOST', 'RETIRED', 'FROZEN');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('COMMISSION_ORIGINATOR', 'COMMISSION_DISTRIBUTOR', 'COMMISSION_AFFILIATE', 'CREDIT_BENEFIT', 'CREDIT_MANUAL', 'DEPOSIT', 'INTERNAL_PURCHASE', 'WITHDRAWAL', 'PAYMENT', 'FEE', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('PENDING', 'CLEARED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BalanceCategory" AS ENUM ('FREE', 'MEAL', 'FOOD', 'FUEL', 'PENDING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "document" TEXT,
    "userType" TEXT NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cpf" TEXT,
    "referredById" TEXT,
    "hasGeneratedRevenue" BOOLEAN NOT NULL DEFAULT false,
    "externalFundingToken" TEXT,
    "dataSharingConsent" BOOLEAN NOT NULL DEFAULT false,
    "billingPlanId" TEXT,
    "tenantId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mintPrice" INTEGER NOT NULL DEFAULT 0,
    "transferPrice" INTEGER NOT NULL DEFAULT 4999,
    "statePrice" INTEGER NOT NULL DEFAULT 0,
    "eventPrice" INTEGER NOT NULL DEFAULT 0,
    "tagPrice" INTEGER NOT NULL DEFAULT 999,
    "isPostpaid" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monthlyMintLimit" INTEGER,
    "monthlyTransferLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "document" TEXT,
    "tenantType" "TenantType" NOT NULL DEFAULT 'GENERIC',
    "originatorFeePercent" DECIMAL(5,4) NOT NULL DEFAULT 0.00,
    "distributorFeePercent" DECIMAL(5,4) NOT NULL DEFAULT 0.00,
    "mccCategory" TEXT,
    "billingPlanId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY['mint', 'transfer', 'state', 'event', 'query']::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "apiKeyPrefix" TEXT,
    "facet" TEXT NOT NULL,
    "assetId" TEXT,
    "assetClass" TEXT,
    "billingPlanId" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "billingStatus" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "paymentRef" TEXT,
    "invoiceId" TEXT,
    "httpMethod" TEXT NOT NULL DEFAULT 'POST',
    "httpPath" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "facet" TEXT NOT NULL,
    "assetId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "systemState" "SystemState" NOT NULL DEFAULT 'ACTIVE',
    "customMetadata" JSONB NOT NULL,
    "metadata" JSONB,
    "qtagHash" TEXT,
    "falconHash" TEXT,
    "fingerprint" TEXT,
    "ntagUID" TEXT,
    "ntagEncodedAt" TIMESTAMP(3),
    "originatorTenantId" TEXT,
    "distributorTenantId" TEXT,
    "paymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyPaymentLimit" DECIMAL(12,2),
    "requirePinAbove" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "eventPayload" JSONB NOT NULL,
    "falconSignature" TEXT,
    "dltAnchorTxId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tenantId" TEXT,
    "freeBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "mealBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "foodBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "fuelBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "pendingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "type" "LedgerTransactionType" NOT NULL,
    "balanceCategory" "BalanceCategory" NOT NULL DEFAULT 'FREE',
    "status" "LedgerStatus" NOT NULL DEFAULT 'PENDING',
    "unlocksAt" TIMESTAMP(3),
    "assetId" TEXT,
    "counterpartyId" TEXT,
    "gatewayProvider" TEXT,
    "externalRef" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FalconKeys" (
    "id" TEXT NOT NULL,
    "publicKeyHash" TEXT NOT NULL,
    "encryptedPublicKey" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FalconKeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_document_key" ON "User"("document");

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- CreateIndex
CREATE INDEX "User_cpf_idx" ON "User"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_slug_key" ON "BillingPlan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_document_key" ON "Tenant"("document");

-- CreateIndex
CREATE INDEX "Tenant_billingPlanId_idx" ON "Tenant"("billingPlanId");

-- CreateIndex
CREATE INDEX "Tenant_tenantType_idx" ON "Tenant"("tenantType");

-- CreateIndex
CREATE INDEX "Tenant_mccCategory_idx" ON "Tenant"("mccCategory");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "ApiKey_key_idx" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiUsageLog_tenantId_timestamp_idx" ON "ApiUsageLog"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiUsageLog_userId_timestamp_idx" ON "ApiUsageLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiUsageLog_billingStatus_idx" ON "ApiUsageLog"("billingStatus");

-- CreateIndex
CREATE INDEX "ApiUsageLog_facet_idx" ON "ApiUsageLog"("facet");

-- CreateIndex
CREATE INDEX "ApiUsageLog_timestamp_idx" ON "ApiUsageLog"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_userId_facet_status_idx" ON "Payment"("userId", "facet", "status");

-- CreateIndex
CREATE INDEX "Payment_externalId_idx" ON "Payment"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_qtagHash_key" ON "Asset"("qtagHash");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_falconHash_key" ON "Asset"("falconHash");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_fingerprint_key" ON "Asset"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_ntagUID_key" ON "Asset"("ntagUID");

-- CreateIndex
CREATE INDEX "Asset_originatorTenantId_idx" ON "Asset"("originatorTenantId");

-- CreateIndex
CREATE INDEX "Asset_distributorTenantId_idx" ON "Asset"("distributorTenantId");

-- CreateIndex
CREATE INDEX "Asset_systemState_idx" ON "Asset"("systemState");

-- CreateIndex
CREATE INDEX "Asset_assetClass_idx" ON "Asset"("assetClass");

-- CreateIndex
CREATE INDEX "AssetEvent_assetId_idx" ON "AssetEvent"("assetId");

-- CreateIndex
CREATE INDEX "AssetEvent_actionType_idx" ON "AssetEvent"("actionType");

-- CreateIndex
CREATE INDEX "AssetEvent_timestamp_idx" ON "AssetEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_tenantId_key" ON "Wallet"("tenantId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_tenantId_idx" ON "Wallet"("tenantId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_walletId_idx" ON "LedgerTransaction"("walletId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_walletId_type_idx" ON "LedgerTransaction"("walletId", "type");

-- CreateIndex
CREATE INDEX "LedgerTransaction_status_idx" ON "LedgerTransaction"("status");

-- CreateIndex
CREATE INDEX "LedgerTransaction_status_unlocksAt_idx" ON "LedgerTransaction"("status", "unlocksAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_createdAt_idx" ON "LedgerTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FalconKeys_publicKeyHash_key" ON "FalconKeys"("publicKeyHash");

-- CreateIndex
CREATE INDEX "FalconKeys_publicKeyHash_idx" ON "FalconKeys"("publicKeyHash");

-- CreateIndex
CREATE INDEX "FalconKeys_entityId_idx" ON "FalconKeys"("entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_originatorTenantId_fkey" FOREIGN KEY ("originatorTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_distributorTenantId_fkey" FOREIGN KEY ("distributorTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
