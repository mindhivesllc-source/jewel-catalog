-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "metafieldDefinitionsAt" TIMESTAMP(3),
ADD COLUMN     "titleTemplate" TEXT NOT NULL DEFAULT '{diaWt}ct {shape} Lab Grown Diamond {jewelryType} {category} in {metal}';

-- CreateTable
CREATE TABLE "ShopCollection" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopCollection_shop_category_key" ON "ShopCollection"("shop", "category");

