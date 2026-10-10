-- Sync remaining schema drift between prisma/schema.prisma and the DB
-- (columns added to the models after migration 20261010120000_add_procurement_advanced was applied).

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "product_name" TEXT,
ADD COLUMN     "sku" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ALTER COLUMN "total_amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "purchase_receipt_items" ADD COLUMN     "accepted_qty" INTEGER,
ADD COLUMN     "batch_number" TEXT,
ADD COLUMN     "expiry_at" TIMESTAMP(3),
ADD COLUMN     "rejected_qty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "payment_terms" TEXT;