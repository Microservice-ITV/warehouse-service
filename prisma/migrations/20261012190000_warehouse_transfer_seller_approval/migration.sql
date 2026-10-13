ALTER TYPE "TransferStatus" ADD VALUE 'SELLER_APPROVED';

ALTER TABLE "warehouse_transfers" ADD COLUMN "approval_seller_user_id" TEXT;

CREATE INDEX "warehouse_transfers_approval_seller_user_id_idx"
  ON "warehouse_transfers"("approval_seller_user_id");
