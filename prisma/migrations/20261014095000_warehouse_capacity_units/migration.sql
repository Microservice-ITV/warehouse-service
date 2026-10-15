-- Max units a warehouse can hold (null = unlimited for existing rows).
ALTER TABLE "warehouses" ADD COLUMN "capacity_units" INTEGER;
