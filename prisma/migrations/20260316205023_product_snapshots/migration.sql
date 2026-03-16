-- CreateTable
CREATE TABLE "product_snapshots" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "categoryId" TEXT,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_snapshots_productId_key" ON "product_snapshots"("productId");

-- CreateIndex
CREATE INDEX "product_snapshots_shopId_idx" ON "product_snapshots"("shopId");

-- CreateIndex
CREATE INDEX "product_snapshots_isActive_idx" ON "product_snapshots"("isActive");
