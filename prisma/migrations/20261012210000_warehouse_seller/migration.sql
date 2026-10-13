ALTER TABLE "warehouses" ADD COLUMN "seller_user_id" TEXT;

CREATE INDEX "warehouses_seller_user_id_idx" ON "warehouses"("seller_user_id");
