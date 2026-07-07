/*
  Warnings:

  - A unique constraint covering the columns `[shop,supplierStockNo]` on the table `ShopifyProductMapping` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ShopifyProductMapping_supplierStockNo_key";

-- CreateIndex
CREATE INDEX "ShopifyProductMapping_shop_idx" ON "ShopifyProductMapping"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyProductMapping_shop_supplierStockNo_key" ON "ShopifyProductMapping"("shop", "supplierStockNo");
