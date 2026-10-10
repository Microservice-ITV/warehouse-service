-- Reconcile schema drift: guarantees that a fresh `prisma migrate deploy`
-- produces an inventory schema identical to prisma/schema.prisma.
-- Written idempotently so it also applies safely to databases that already
-- have these objects (created previously via `prisma db push`).

-- 1) TransferStatus enum (never created by any earlier migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransferStatus') THEN
    CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

-- 2) MovementType enum -> PURCHASE_RECEIVED, PURCHASE_RETURNED, SALE_ISSUED,
--    TRANSFER_IN, TRANSFER_OUT, RETURN_RECEIVED, INITIAL_BALANCE
--    (adds PURCHASE_RETURNED, drops ADJUSTMENT/STOCK_TAKE)
DO $$
DECLARE
  v_labels text[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
    INTO v_labels
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typname = 'MovementType';

  IF v_labels IS NULL THEN
    RAISE NOTICE 'MovementType not found, skipping enum reconcile';
    RETURN;
  END IF;

  IF v_labels = ARRAY['PURCHASE_RECEIVED','PURCHASE_RETURNED','SALE_ISSUED','TRANSFER_IN','TRANSFER_OUT','RETURN_RECEIVED','INITIAL_BALANCE'] THEN
    RAISE NOTICE 'MovementType already matches schema, skipping';
    RETURN;
  END IF;

  EXECUTE 'CREATE TYPE "MovementType_reconcile" AS ENUM (''PURCHASE_RECEIVED'',''PURCHASE_RETURNED'',''SALE_ISSUED'',''TRANSFER_IN'',''TRANSFER_OUT'',''RETURN_RECEIVED'',''INITIAL_BALANCE'')';
  EXECUTE 'ALTER TABLE "inventory_movements" ALTER COLUMN "movement_type" TYPE "MovementType_reconcile" USING ("movement_type"::text::"MovementType_reconcile")';
  EXECUTE 'ALTER TYPE "MovementType" RENAME TO "MovementType_old"';
  EXECUTE 'ALTER TYPE "MovementType_reconcile" RENAME TO "MovementType"';
  EXECUTE 'DROP TYPE "MovementType_old"';
END $$;

-- 3) purchase_orders.total_amount must be DECIMAL(14,2)
ALTER TABLE "purchase_orders" ALTER COLUMN "total_amount" SET DATA TYPE DECIMAL(14,2);

-- 4) warehouse_transfers table (never created by any earlier migration)
CREATE TABLE IF NOT EXISTS "warehouse_transfers" (
    "id" TEXT NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "reference_id" TEXT,
    "reference_type" TEXT,
    "requested_by" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_transfers_pkey" PRIMARY KEY ("id")
);

-- 5) warehouse_transfers indexes
CREATE INDEX IF NOT EXISTS "warehouse_transfers_status_created_at_idx" ON "warehouse_transfers"("status", "created_at");
CREATE INDEX IF NOT EXISTS "warehouse_transfers_from_warehouse_id_idx" ON "warehouse_transfers"("from_warehouse_id");
CREATE INDEX IF NOT EXISTS "warehouse_transfers_to_warehouse_id_idx" ON "warehouse_transfers"("to_warehouse_id");