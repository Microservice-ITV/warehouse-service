-- Actual exchange rate when the goods arrive (null = use exchange_rate).
ALTER TABLE "purchase_orders" ADD COLUMN "received_exchange_rate" DECIMAL(14,6);
