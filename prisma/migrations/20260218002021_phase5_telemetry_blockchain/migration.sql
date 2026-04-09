-- AlterTable
ALTER TABLE "ApiUsageLog" ADD COLUMN     "deviceId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "deviceId" TEXT;

-- CreateIndex
CREATE INDEX "ApiUsageLog_deviceId_idx" ON "ApiUsageLog"("deviceId");

-- CreateIndex
CREATE INDEX "Payment_deviceId_idx" ON "Payment"("deviceId");
