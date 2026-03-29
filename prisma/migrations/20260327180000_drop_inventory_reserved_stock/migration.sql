-- Checkout no longer reserves warehouse inventory; quantity is tracked as available only.

ALTER TABLE "inventories" DROP COLUMN IF EXISTS "reservedStock";
