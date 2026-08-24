-- AlterTable
ALTER TABLE "AdAccount" ADD COLUMN     "frequency" DECIMAL(65,30),
ADD COLUMN     "reach" INTEGER,
ADD COLUMN     "reachDays" INTEGER,
ADD COLUMN     "reachSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AdSpendDaily" ADD COLUMN     "linkClicks" INTEGER,
ADD COLUMN     "metaPurchaseValue" DECIMAL(65,30),
ADD COLUMN     "metaPurchases" INTEGER;

