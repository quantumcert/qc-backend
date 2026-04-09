-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_issuerId_idx" ON "Asset"("issuerId");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");

-- CreateIndex
CREATE INDEX "PaymentIntent_deviceId_idx" ON "PaymentIntent"("deviceId");

-- CreateIndex
CREATE INDEX "PaymentIntent_assetId_idx" ON "PaymentIntent"("assetId");
