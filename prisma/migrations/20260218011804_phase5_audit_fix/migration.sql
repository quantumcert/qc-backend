/*
  Warnings:

  - A unique constraint covering the columns `[externalRef]` on the table `LedgerTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_externalRef_key" ON "LedgerTransaction"("externalRef");
