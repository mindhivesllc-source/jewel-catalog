-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "supplierApiKey" TEXT NOT NULL DEFAULT '',
    "lastFetchAt" TIMESTAMP(3),
    "vendor" TEXT NOT NULL DEFAULT 'LGD USA',
    "compareAtPriceRule" TEXT NOT NULL DEFAULT 'none',
    "compareAtMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "compareAtFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultLocationId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" SERIAL NOT NULL,
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
    "price" DOUBLE PRECISION NOT NULL,
    "castingWt" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "image1" TEXT NOT NULL,
    "image2" TEXT NOT NULL,
    "video" TEXT NOT NULL,
    "syncHash" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyProductMapping" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "supplierStockNo" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyProductTitle" TEXT,
    "pushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushJob" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "totalSelected" INTEGER NOT NULL DEFAULT 0,
    "pushedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushLog" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "jobId" INTEGER NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "stockNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushLog_pkey" PRIMARY KEY ("id")
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

