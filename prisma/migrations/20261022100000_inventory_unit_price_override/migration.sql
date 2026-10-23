-- Seller-entered unit price per stock row (null = use the purchase order calculation).
ALTER TABLE "inventory_stocks" ADD COLUMN "unit_price_override" DECIMAL(12,2);
