-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "producer" TEXT,
    "correlationId" TEXT,
    "checkoutId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_events_eventId_key" ON "processed_events"("eventId");

-- CreateIndex
CREATE INDEX "processed_events_event_idx" ON "processed_events"("event");

-- CreateIndex
CREATE INDEX "processed_events_checkoutId_idx" ON "processed_events"("checkoutId");
