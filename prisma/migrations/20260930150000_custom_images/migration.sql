-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "customImageTemplate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "customImageCount" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "includeSupplierImages" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShopifyProductMapping" ADD COLUMN     "mediaSignature" TEXT;
