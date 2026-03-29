-- Denormalized main/parent category when product category is a subcategory (from product-service events).
ALTER TABLE "product_snapshots" ADD COLUMN "parentCategoryId" TEXT;
ALTER TABLE "product_snapshots" ADD COLUMN "parentCategoryName" TEXT;
ALTER TABLE "product_snapshots" ADD COLUMN "parentCategorySlug" TEXT;
