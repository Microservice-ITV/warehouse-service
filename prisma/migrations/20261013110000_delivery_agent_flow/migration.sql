-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'DELIVERY_PICKED_UP';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'AWAITING_SELLER_RECEIPT';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'SELLER_RECEIVED';

-- CreateEnum
CREATE TYPE "DamageReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterTable
ALTER TABLE "purchase_order_items"
ADD COLUMN "color_id" TEXT,
ADD COLUMN "size_id" TEXT,
ADD COLUMN "color_name" TEXT,
ADD COLUMN "size_name" TEXT,
ADD COLUMN "length" DECIMAL(12,4),
ADD COLUMN "width" DECIMAL(12,4),
ADD COLUMN "height" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" TEXT NOT NULL,
    "report_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "reported_by" TEXT NOT NULL,
    "notes" TEXT,
    "status" "DamageReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_report_items" (
    "id" TEXT NOT NULL,
    "damage_report_id" TEXT NOT NULL,
    "purchase_order_item_id" TEXT,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "product_name" TEXT,
    "quantity" INTEGER NOT NULL,
    "damage_type" TEXT,
    "notes" TEXT,

    CONSTRAINT "damage_report_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "damage_reports_report_number_key" ON "damage_reports"("report_number");

-- CreateIndex
CREATE INDEX "damage_reports_purchase_order_id_created_at_idx" ON "damage_reports"("purchase_order_id", "created_at");

-- CreateIndex
CREATE INDEX "damage_reports_reported_by_idx" ON "damage_reports"("reported_by");

-- CreateIndex
CREATE INDEX "damage_report_items_damage_report_id_idx" ON "damage_report_items"("damage_report_id");

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_report_items" ADD CONSTRAINT "damage_report_items_damage_report_id_fkey" FOREIGN KEY ("damage_report_id") REFERENCES "damage_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_report_items" ADD CONSTRAINT "damage_report_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
