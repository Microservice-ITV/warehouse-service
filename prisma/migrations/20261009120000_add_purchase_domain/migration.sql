-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "purchase_outbox_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "payment_terms" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "ordered_at" TIMESTAMP(3),
    "expected_at" TIMESTAMP(3),
    "subtotal" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "sku" TEXT,
    "product_name" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "status" "PurchaseReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "received_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_items" (
    "id" TEXT NOT NULL,
    "purchase_receipt_id" TEXT NOT NULL,
    "purchase_order_item_id" TEXT,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "accepted_qty" INTEGER,
    "rejected_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "batch_number" TEXT,
    "expiry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "warehouse_id" TEXT NOT NULL,
    "status" "PurchaseReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "returned_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "purchase_return_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_status_history" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL,
    "note" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_outbox_events_event_id_key" ON "purchase_outbox_events"("event_id");

-- CreateIndex
CREATE INDEX "purchase_outbox_events_status_created_at_idx" ON "purchase_outbox_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_status_idx" ON "suppliers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_order_number_key" ON "purchase_orders"("order_number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_warehouse_id_idx" ON "purchase_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_created_at_idx" ON "purchase_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_product_id_idx" ON "purchase_order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_receipt_number_key" ON "purchase_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "purchase_receipts_purchase_order_id_idx" ON "purchase_receipts"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_receipts_warehouse_id_idx" ON "purchase_receipts"("warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_receipts_status_idx" ON "purchase_receipts"("status");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_purchase_receipt_id_idx" ON "purchase_receipt_items"("purchase_receipt_id");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_product_id_idx" ON "purchase_receipt_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_return_number_key" ON "purchase_returns"("return_number");

-- CreateIndex
CREATE INDEX "purchase_returns_supplier_id_idx" ON "purchase_returns"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_returns_warehouse_id_idx" ON "purchase_returns"("warehouse_id");

-- CreateIndex
CREATE INDEX "purchase_returns_status_idx" ON "purchase_returns"("status");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchase_return_id_idx" ON "purchase_return_items"("purchase_return_id");

-- CreateIndex
CREATE INDEX "purchase_return_items_product_id_idx" ON "purchase_return_items"("product_id");

-- CreateIndex
CREATE INDEX "purchase_order_status_history_purchase_order_id_created_at_idx" ON "purchase_order_status_history"("purchase_order_id", "created_at");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_status_history" ADD CONSTRAINT "purchase_order_status_history_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;