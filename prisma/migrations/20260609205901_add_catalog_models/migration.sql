-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "supplierApiKey" TEXT NOT NULL DEFAULT '',
    "lastFetchAt" DATETIME,
    "vendor" TEXT NOT NULL DEFAULT 'LGD USA',
    "compareAtPriceRule" TEXT NOT NULL DEFAULT 'none',
    "compareAtMultiplier" REAL NOT NULL DEFAULT 1.5,
    "compareAtFixed" REAL NOT NULL DEFAULT 0,
    "defaultLocationId" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "stockNo" TEXT NOT NULL,
    "subitem" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "jewelryType" TEXT NOT NULL,
    "metalType" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "clarity" TEXT NOT NULL,
    "diaPcs" TEXT NOT NULL,
    "diaWt" TEXT NOT NULL,
    "grossWt" TEXT NOT NULL,
    "growthType" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "certificate" TEXT NOT NULL,
    "inhandPcs" TEXT NOT NULL,
    "memoOut" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "castingWt" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "image1" TEXT NOT NULL,
    "image2" TEXT NOT NULL,
    "video" TEXT NOT NULL,
    "syncHash" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShopifyProductMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "supplierStockNo" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyProductTitle" TEXT,
    "pushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PushJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "totalSelected" INTEGER NOT NULL DEFAULT 0,
    "pushedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PushLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "jobId" INTEGER NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "stockNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_category_idx" ON "SupplierProduct"("shop", "category");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_jewelryType_idx" ON "SupplierProduct"("shop", "jewelryType");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_metalType_idx" ON "SupplierProduct"("shop", "metalType");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_shape_idx" ON "SupplierProduct"("shop", "shape");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_size_idx" ON "SupplierProduct"("shop", "size");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_clarity_idx" ON "SupplierProduct"("shop", "clarity");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_selected_idx" ON "SupplierProduct"("shop", "selected");

-- CreateIndex
CREATE INDEX "SupplierProduct_shop_pushed_idx" ON "SupplierProduct"("shop", "pushed");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_shop_stockNo_key" ON "SupplierProduct"("shop", "stockNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyProductMapping_supplierStockNo_key" ON "ShopifyProductMapping"("supplierStockNo");

-- CreateIndex
CREATE INDEX "PushJob_shop_status_idx" ON "PushJob"("shop", "status");

-- CreateIndex
CREATE INDEX "PushLog_jobId_idx" ON "PushLog"("jobId");
