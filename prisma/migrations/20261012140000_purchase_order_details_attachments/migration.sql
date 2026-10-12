ALTER TABLE "purchase_orders" ADD COLUMN "supplier_contact" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "order_date" TIMESTAMP(3);

CREATE TABLE "purchase_order_attachments" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_attachments_purchase_order_id_idx" ON "purchase_order_attachments"("purchase_order_id");

ALTER TABLE "purchase_order_attachments" ADD CONSTRAINT "purchase_order_attachments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
