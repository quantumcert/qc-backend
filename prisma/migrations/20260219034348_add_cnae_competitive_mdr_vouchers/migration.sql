-- AlterTable
ALTER TABLE "BillingPlan" ADD COLUMN     "mdrBoletoFixed" DECIMAL(6,2),
ADD COLUMN     "mdrCreditRate" DECIMAL(6,4),
ADD COLUMN     "mdrCreditSpread" DECIMAL(6,4),
ADD COLUMN     "mdrDebitRate" DECIMAL(6,4),
ADD COLUMN     "mdrPixRate" DECIMAL(6,4),
ADD COLUMN     "mdrVoucherRate" DECIMAL(6,4);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "cnae" TEXT;

-- CreateIndex
CREATE INDEX "Tenant_cnae_idx" ON "Tenant"("cnae");
