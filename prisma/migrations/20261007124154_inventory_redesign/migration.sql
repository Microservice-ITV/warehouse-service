/*
  Warnings:

  - You are about to drop the column `createdAt` on the `warehouses` table. All the data in the column will be lost.
  - You are about to drop the column `defaultMarker` on the `warehouses` table. All the data in the column will be lost.
  - You are about to drop the column `isDefault` on the `warehouses` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `warehouses` table. All the data in the column will be lost.
  - You are about to drop the column `shopId` on the `warehouses` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `warehouses` table. All the data in the column will be lost.
  - You are about to drop the `inventories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stock_movements` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE_RECEIVED', 'SALE_ISSUED', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'STOCK_TAKE', 'RETURN_RECEIVED', 'INITIAL_BALANCE');

-- DropForeignKey
ALTER TABLE "inventories" DROP CONSTRAINT "inventories_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_warehouseId_productId_fkey";

-- DropIndex
DROP INDEX "warehouses_defaultMarker_key";

-- DropIndex
DROP INDEX "warehouses_shopId_idx";

-- DropIndex
DROP INDEX "warehouses_shopId_isDefault_idx";

-- AlterTable
ALTER TABLE "warehouses" DROP COLUMN "createdAt",
DROP COLUMN "defaultMarker",
DROP COLUMN "isDefault",
DROP COLUMN "location",
DROP COLUMN "shopId",
DROP COLUMN "updatedAt",
ADD COLUMN     "address" TEXT;

-- DropTable
DROP TABLE "inventories";

-- DropTable
DROP TABLE "stock_movements";

-- DropEnum
DROP TYPE "StockMovementReferenceType";

-- DropEnum
DROP TYPE "StockMovementType";

-- CreateTable
CREATE TABLE "inventory_stocks" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "available_qty" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "movement_type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "before_qty" INTEGER NOT NULL,
    "after_qty" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "unit_cost" DECIMAL(12,2),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_stocks_product_id_idx" ON "inventory_stocks"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stocks_warehouse_id_product_id_variant_id_key" ON "inventory_stocks"("warehouse_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "inventory_movements_product_id_warehouse_id_idx" ON "inventory_movements"("product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_movements_warehouse_id_created_at_idx" ON "inventory_movements"("warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_movement_type_idx" ON "inventory_movements"("movement_type");

-- CreateIndex
CREATE INDEX "inventory_movements_reference_id_idx" ON "inventory_movements"("reference_id");

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
