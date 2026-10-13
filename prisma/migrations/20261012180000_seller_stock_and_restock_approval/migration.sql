ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'RESTOCK_APPROVED';

ALTER TABLE "purchase_orders" ALTER COLUMN "supplier_id" DROP NOT NULL;

ALTER TABLE "warehouse_transfers" ALTER COLUMN "from_warehouse_id" DROP NOT NULL;
ALTER TABLE "warehouse_transfers" ADD COLUMN "from_seller_user_id" TEXT;

CREATE TABLE "seller_stocks" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_id" TEXT NOT NULL DEFAULT '',
  "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
  "available_qty" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_stocks_user_id_product_id_variant_id_key"
  ON "seller_stocks"("user_id", "product_id", "variant_id");
CREATE INDEX "seller_stocks_user_id_idx" ON "seller_stocks"("user_id");
