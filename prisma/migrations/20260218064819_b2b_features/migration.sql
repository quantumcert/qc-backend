-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "isRetargeted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Asset_batchId_idx" ON "Asset"("batchId");
