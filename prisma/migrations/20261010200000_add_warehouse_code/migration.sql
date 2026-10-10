-- Add optional unique warehouse code column
ALTER TABLE "warehouses" ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");