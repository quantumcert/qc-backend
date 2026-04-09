-- CreateEnum
CREATE TYPE "PinPreference" AS ENUM ('TERMINAL', 'OWN_DEVICE');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "pinPromptPreference" "PinPreference" NOT NULL DEFAULT 'OWN_DEVICE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "transactionPin" TEXT;
