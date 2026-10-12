-- Remember which seller created each warehouse. Existing rows stay unassigned and admin-only.
ALTER TABLE "warehouses" ADD COLUMN "createdBy" TEXT;

CREATE INDEX "warehouses_createdBy_idx" ON "warehouses"("createdBy");
