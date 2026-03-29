-- Drop checkout stock reservation tables (reservation flow lives in product-service only).

DROP TABLE IF EXISTS "stock_reservation_items";

DROP TABLE IF EXISTS "stock_reservations";

DROP TYPE IF EXISTS "ReservationStatus";
