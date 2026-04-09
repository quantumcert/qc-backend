-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "lastTapAt" TIMESTAMP(3),
ADD COLUMN     "lastTapCounter" INTEGER NOT NULL DEFAULT 0;
