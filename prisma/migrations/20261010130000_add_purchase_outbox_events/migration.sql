-- Backfill the purchase_outbox_events table that was added to schema.prisma
-- after migration 20261009120000_add_purchase_domain was applied in this DB.

-- CreateTable
CREATE TABLE "purchase_outbox_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_outbox_events_event_id_key" ON "purchase_outbox_events"("event_id");

-- CreateIndex
CREATE INDEX "purchase_outbox_events_status_created_at_idx" ON "purchase_outbox_events"("status", "created_at");