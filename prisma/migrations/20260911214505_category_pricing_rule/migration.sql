-- CreateTable
CREATE TABLE "CategoryPricingRule" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "markupType" TEXT NOT NULL DEFAULT 'percent',
    "markupValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roundTo" TEXT NOT NULL DEFAULT 'none',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryPricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryPricingRule_shop_category_key" ON "CategoryPricingRule"("shop", "category");

