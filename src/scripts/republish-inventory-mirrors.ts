/**
 * One-shot: re-emit inventory.updated for every product that has stock rows
 * so product-service / ecommerce-read can refresh warehouse mirrors.
 *
 *   npx tsx src/scripts/republish-inventory-mirrors.ts
 */
import prisma from '@/config/database';
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
  for (const productId of productIds) {
    const snapshots = await productSnapshotRepository.findByProductIds([productId]);
    const shopId = snapshots[0]?.shopId;
    if (!shopId) {
      console.warn(`skip ${productId}: no product snapshot / shopId`);
      continue;
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

  console.log(`done: queued ${published}/${productIds.length} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
