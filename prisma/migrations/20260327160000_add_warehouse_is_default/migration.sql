-- Align DB with Prisma schema: default warehouse markers per shop.

ALTER TABLE "warehouses" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "warehouses" ADD COLUMN "defaultMarker" TEXT;

CREATE UNIQUE INDEX "warehouses_defaultMarker_key" ON "warehouses"("defaultMarker");

CREATE INDEX "warehouses_shopId_isDefault_idx" ON "warehouses"("shopId", "isDefault");
