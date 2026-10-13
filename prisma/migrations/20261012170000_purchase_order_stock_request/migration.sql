ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'LOW_STOCK';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'RESTOCK_REQUESTED';

CREATE TYPE "PurchaseOrderKind" AS ENUM ('WAREHOUSE', 'SUPPLIER');

ALTER TABLE "purchase_orders"
  ADD COLUMN "order_kind" "PurchaseOrderKind" NOT NULL DEFAULT 'SUPPLIER';
