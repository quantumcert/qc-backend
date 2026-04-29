-- AlterEnum
ALTER TYPE "EscrowStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN "releaseConfirmedAt" TIMESTAMP(3),
ADD COLUMN "releaseMode" TEXT NOT NULL DEFAULT 'AUTO';
