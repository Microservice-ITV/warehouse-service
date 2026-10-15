-- Delivery agent confirms variation + quantity before sending parcel to seller.
CREATE TABLE "delivery_handoffs" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "confirmed_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_handoff_items" (
    "id" TEXT NOT NULL,
    "delivery_handoff_id" TEXT NOT NULL,
    "purchase_order_item_id" TEXT,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "product_name" TEXT,
    "color_name" TEXT,
    "size_name" TEXT,
    "ordered_qty" INTEGER NOT NULL,
    "confirmed_qty" INTEGER NOT NULL,
    "variation_correct" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "delivery_handoff_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_handoffs_purchase_order_id_created_at_idx" ON "delivery_handoffs"("purchase_order_id", "created_at");
CREATE INDEX "delivery_handoffs_confirmed_by_idx" ON "delivery_handoffs"("confirmed_by");
CREATE INDEX "delivery_handoff_items_delivery_handoff_id_idx" ON "delivery_handoff_items"("delivery_handoff_id");

ALTER TABLE "delivery_handoffs" ADD CONSTRAINT "delivery_handoffs_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_handoff_items" ADD CONSTRAINT "delivery_handoff_items_delivery_handoff_id_fkey" FOREIGN KEY ("delivery_handoff_id") REFERENCES "delivery_handoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_handoff_items" ADD CONSTRAINT "delivery_handoff_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
