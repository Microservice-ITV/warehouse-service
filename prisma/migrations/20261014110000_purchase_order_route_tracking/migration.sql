-- Transit route tracking for supplier purchase orders.

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "route_leg_index" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'ARRIVED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_WAREHOUSE_RECEIPT';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'WAREHOUSE_RECEIVED';

CREATE TABLE IF NOT EXISTS "purchase_order_route_stops" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "arrived_at" TIMESTAMP(3),
    "arrived_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_order_route_stops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_route_stops_purchase_order_id_sequence_key"
  ON "purchase_order_route_stops"("purchase_order_id", "sequence");

CREATE INDEX IF NOT EXISTS "purchase_order_route_stops_purchase_order_id_idx"
  ON "purchase_order_route_stops"("purchase_order_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_route_stops_purchase_order_id_fkey'
  ) THEN
    ALTER TABLE "purchase_order_route_stops"
      ADD CONSTRAINT "purchase_order_route_stops_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
