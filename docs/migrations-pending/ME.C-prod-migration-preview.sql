-- CreateTable
CREATE TABLE "AdSpendCampaignDaily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "spend" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdSpendCampaignDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdSpendCampaignDaily_tenantId_date_idx" ON "AdSpendCampaignDaily"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpendCampaignDaily_tenantId_adAccountId_date_campaignId_key" ON "AdSpendCampaignDaily"("tenantId", "adAccountId", "date", "campaignId");

-- AddForeignKey
ALTER TABLE "AdSpendCampaignDaily" ADD CONSTRAINT "AdSpendCampaignDaily_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

