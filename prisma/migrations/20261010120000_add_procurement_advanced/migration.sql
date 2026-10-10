-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

-- CreateEnum
CREATE TYPE "CostAllocationMethod" AS ENUM ('QUANTITY', 'WEIGHT', 'VOLUME', 'VALUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "CostStatus" AS ENUM ('ESTIMATED', 'ACTUAL');

-- CreateEnum
CREATE TYPE "AdditionalCostCategory" AS ENUM ('HANDLING', 'CUSTOMS', 'INSURANCE', 'TAX', 'FREIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseCostAdjustmentType" AS ENUM ('FREIGHT', 'INVOICE', 'OTHER');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "purchase_orders" RENAME COLUMN "total" TO "total_amount";
ALTER TABLE "purchase_orders" ADD COLUMN "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN "payment_terms" TEXT,
ADD COLUMN "delivery_terms" TEXT,
ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "shipping_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN "unit" TEXT,
ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "weight_per_unit" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN "volume_per_unit" DECIMAL(12,6) NOT NULL DEFAULT 0,
ADD COLUMN "accepted_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "rejected_qty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "purchase_delivery_stages" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "carrier" TEXT,
    "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allocation_method" "CostAllocationMethod" NOT NULL DEFAULT 'QUANTITY',
    "applicable_product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_delivery_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_additional_costs" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AdditionalCostCategory" NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allocation_method" "CostAllocationMethod" NOT NULL DEFAULT 'QUANTITY',
    "status" "CostStatus" NOT NULL DEFAULT 'ESTIMATED',
    "applicable_product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_additional_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_cost_adjustments" (
    "id" TEXT NOT NULL,
    "adjustment_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "type" "PurchaseCostAdjustmentType" NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allocation_method" "CostAllocationMethod" NOT NULL DEFAULT 'QUANTITY',
    "reason" TEXT,
    "is_applied" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_cost_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_delivery_stages_purchase_order_id_idx" ON "purchase_delivery_stages"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_additional_costs_purchase_order_id_idx" ON "purchase_additional_costs"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_cost_adjustments_adjustment_number_key" ON "purchase_cost_adjustments"("adjustment_number");

-- CreateIndex
CREATE INDEX "purchase_cost_adjustments_purchase_order_id_idx" ON "purchase_cost_adjustments"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "purchase_delivery_stages" ADD CONSTRAINT "purchase_delivery_stages_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_additional_costs" ADD CONSTRAINT "purchase_additional_costs_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_cost_adjustments" ADD CONSTRAINT "purchase_cost_adjustments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
