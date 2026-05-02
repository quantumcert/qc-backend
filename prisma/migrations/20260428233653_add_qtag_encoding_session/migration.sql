-- CreateEnum TapVerdict (was created via db push, not in migrations)
DO $$ BEGIN
  CREATE TYPE "TapVerdict" AS ENUM ('VALID', 'REPLAY_BLOCKED', 'CMAC_INVALID', 'DEVICE_INACTIVE', 'DEVICE_NOT_FOUND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add RELAY_ATTACK value if not exists
ALTER TYPE "TapVerdict" ADD VALUE IF NOT EXISTS 'RELAY_ATTACK';

-- CreateTable Device (was created via db push, not in migrations)
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
CREATE INDEX IF NOT EXISTS "Device_tenantId_idx" ON "Device"("tenantId");

-- CreateTable DeviceTapLog (was created via db push, not in migrations)
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

DO $$ BEGIN
  ALTER TABLE "DeviceTapLog" ADD CONSTRAINT "DeviceTapLog_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable Device (add columns if not exists — safe on fresh DB)
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastLat" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastLon" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "sdmEncKeyId" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "sdmMacKeyId" TEXT;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EncodingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable EncodingSession
CREATE TABLE IF NOT EXISTS "EncodingSession" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "EncodingSession_assetId_key" ON "EncodingSession"("assetId");
CREATE INDEX IF NOT EXISTS "EncodingSession_tenantId_idx" ON "EncodingSession"("tenantId");
CREATE INDEX IF NOT EXISTS "EncodingSession_ntagUID_idx" ON "EncodingSession"("ntagUID");
CREATE INDEX IF NOT EXISTS "EncodingSession_status_idx" ON "EncodingSession"("status");
