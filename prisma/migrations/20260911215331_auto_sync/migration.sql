-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncMessage" TEXT,
ADD COLUMN     "syncLockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierProduct" ADD COLUMN     "delistedAt" TIMESTAMP(3),
ADD COLUMN     "lastPushedHash" TEXT;

-- AlterTable
ALTER TABLE "PushJob" ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'manual';

