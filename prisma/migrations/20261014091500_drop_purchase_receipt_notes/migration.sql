-- Remove unused notes column from goods receipts (GRN).
ALTER TABLE "purchase_receipts" DROP COLUMN IF EXISTS "notes";
