-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "utmCampaign" TEXT;

-- AlterTable
ALTER TABLE "StorefrontVisit" ADD COLUMN     "deviceClass" TEXT,
ADD COLUMN     "exitSection" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT;

