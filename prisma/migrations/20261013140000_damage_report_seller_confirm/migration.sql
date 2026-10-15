-- AlterEnum
ALTER TYPE "DamageReportStatus" ADD VALUE 'CONFIRMED';

-- AlterTable
ALTER TABLE "damage_reports"
ADD COLUMN "confirmed_by" TEXT,
ADD COLUMN "confirmed_at" TIMESTAMP(3),
ADD COLUMN "stock_reduced_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "damage_reports_status_idx" ON "damage_reports"("status");
