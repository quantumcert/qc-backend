-- CreateEnum
CREATE TYPE "EncodingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum (if not exists — TapVerdict was missing from production DB)
DO $$ BEGIN
  CREATE TYPE "TapVerdict" AS ENUM ('VALID', 'REPLAY_BLOCKED', 'CMAC_INVALID', 'DEVICE_INACTIVE', 'DEVICE_NOT_FOUND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "TapVerdict" ADD VALUE IF NOT EXISTS 'RELAY_ATTACK';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLon" DOUBLE PRECISION,
ADD COLUMN     "sdmEncKeyId" TEXT,
ADD COLUMN     "sdmMacKeyId" TEXT;

-- CreateTable
CREATE TABLE "EncodingSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ntagUID" TEXT NOT NULL,
    "status" "EncodingStatus" NOT NULL DEFAULT 'PENDING',
    "layoutB64" TEXT NOT NULL,
    "sdmMacKeyId" TEXT NOT NULL,
    "sdmEncKeyId" TEXT NOT NULL,
    "anchorTxId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncodingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EncodingSession_assetId_key" ON "EncodingSession"("assetId");

-- CreateIndex
CREATE INDEX "EncodingSession_tenantId_idx" ON "EncodingSession"("tenantId");

-- CreateIndex
CREATE INDEX "EncodingSession_ntagUID_idx" ON "EncodingSession"("ntagUID");

-- CreateIndex
CREATE INDEX "EncodingSession_status_idx" ON "EncodingSession"("status");
