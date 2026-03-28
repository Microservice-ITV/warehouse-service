-- Prisma schema expects these columns; initial migration only had a minimal stock_movements row.

CREATE TYPE "StockMovementReferenceType" AS ENUM (
  'UNSPECIFIED',
  'BOOTSTRAP',
  'CHECKOUT',
  'RESERVATION',
  'MANUAL',
  'PO',
  'STOCK_TAKE',
  'TRANSFER'
);

ALTER TABLE "stock_movements" ADD COLUMN "referenceType" "StockMovementReferenceType" NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE "stock_movements" ADD COLUMN "checkoutId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "orderId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "reservationId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "metadata" JSONB;

CREATE INDEX "stock_movements_referenceType_idx" ON "stock_movements"("referenceType");
CREATE INDEX "stock_movements_checkoutId_idx" ON "stock_movements"("checkoutId");
CREATE INDEX "stock_movements_orderId_idx" ON "stock_movements"("orderId");
CREATE INDEX "stock_movements_reservationId_idx" ON "stock_movements"("reservationId");
