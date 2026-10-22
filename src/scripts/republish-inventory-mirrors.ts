/**
 * One-shot: re-emit inventory.updated for every product that has stock rows
 * so product-service / ecommerce-read can refresh warehouse mirrors.
 *
 * Heals missing product_snapshots by fetching shopId from product-service.
 *
 *   npx tsx src/scripts/republish-inventory-mirrors.ts
 */
import prisma from '@/config/database';
import { fetchCatalogProduct } from '@/clients/productCatalog.client';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { EventsPublisher } from '@/publishers/events.publisher';
import { buildInventoryVariantBreakdown } from '@/utils/inventoryVariantBreakdown';

async function main() {
  const inventoryRepository = new InventoryRepository();
  const productSnapshotRepository = new ProductSnapshotRepository();
  const eventsPublisher = new EventsPublisher();

  const productIds = (
    await prisma.inventoryStock.findMany({
      select: { productId: true },
      distinct: ['productId'],
    })
  ).map((row) => row.productId);

  let published = 0;
  let healed = 0;
  let skipped = 0;

  for (const productId of productIds) {
    let snapshots = await productSnapshotRepository.findByProductIds([productId]);
    let shopId = snapshots[0]?.shopId;

    if (!shopId) {
      const catalog = await fetchCatalogProduct(productId);
      if (!catalog) {
        console.warn(`skip ${productId}: no product snapshot / shopId (catalog fetch failed)`);
        skipped += 1;
        continue;
      }
      await productSnapshotRepository.upsert({
        productId: catalog.productId,
        shopId: catalog.shopId,
        categoryId: catalog.categoryId,
        slug: catalog.slug,
        title: catalog.title,
        description: catalog.description,
        sku: catalog.sku,
        price: catalog.price,
        currency: catalog.currency,
        images: catalog.images,
        imageUrl: catalog.imageUrl,
        isActive: catalog.isActive,
      });
      shopId = catalog.shopId;
      healed += 1;
      console.log(`healed snapshot ${productId} shopId=${shopId}`);
    }

    const totals = await inventoryRepository.computeTotalsByProductId(productId);
    const variantRows = await inventoryRepository.listVariantTotalsByProductId(productId);
    const variants = await buildInventoryVariantBreakdown(productId, variantRows);

    await eventsPublisher.publishInventoryUpdated({
      productId,
      shopId,
      totalStock: totals.total,
      availableStock: totals.available,
      variants,
      correlationId: `republish-inventory-mirrors:${productId}:${Date.now()}`,
    });
    published += 1;
    console.log(
      `queued inventory.updated ${productId} available=${totals.available} variants=${variants.length}`,
    );
  }

  console.log(
    `done: queued ${published}/${productIds.length} products (healedSnapshots=${healed}, skipped=${skipped})`,
  );
  console.log(
    'Note: outbox publisher must be running so events reach product-service / ecommerce-read.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
