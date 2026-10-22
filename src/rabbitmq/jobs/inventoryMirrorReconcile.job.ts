import prisma from '@/config/database';
import env from '@/config/env';
import { fetchCatalogProduct } from '@/clients/productCatalog.client';
import { EventsPublisher } from '@/publishers/events.publisher';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { buildInventoryVariantBreakdown } from '@/utils/inventoryVariantBreakdown';
import logger from '@/utils/logger';

const inventoryRepository = new InventoryRepository();
const productSnapshotRepository = new ProductSnapshotRepository();
const eventsPublisher = new EventsPublisher();

/**
 * Production heal: after GRN, inventory can exist while product/frontend mirrors
 * stay at 0 when inventory.updated was skipped (missing snapshot) or dropped.
 * Periodically backfill snapshots from product-service and re-queue inventory.updated.
 */
export const runInventoryMirrorReconcile = async (): Promise<{
  scanned: number;
  healedSnapshots: number;
  published: number;
  skipped: number;
}> => {
  const lookbackMs = env.INVENTORY_MIRROR_RECONCILE_LOOKBACK_MS;
  const since = new Date(Date.now() - lookbackMs);

  const recentRows = await prisma.inventoryStock.findMany({
    where: { updatedAt: { gte: since } },
    select: { productId: true },
    distinct: ['productId'],
    take: env.INVENTORY_MIRROR_RECONCILE_BATCH_SIZE,
  });

  // Products with available stock but no product_snapshots row (GRN landed
  // before product.created was consumed — common prod drift).
  const orphanRows = await prisma.$queryRaw<Array<{ product_id: string }>>`
    SELECT DISTINCT s.product_id
    FROM inventory_stocks s
    LEFT JOIN product_snapshots p ON p."productId" = s.product_id
    WHERE s.available_qty > 0
      AND p."productId" IS NULL
    LIMIT ${env.INVENTORY_MIRROR_RECONCILE_BATCH_SIZE}
  `;

  const productIds = [
    ...new Set([
      ...recentRows.map((row) => row.productId),
      ...orphanRows.map((row) => row.product_id),
    ]),
  ];

  let healedSnapshots = 0;
  let published = 0;
  let skipped = 0;

  for (const productId of productIds) {
    let snapshots = await productSnapshotRepository.findByProductIds([productId]);
    let shopId = snapshots[0]?.shopId;

    if (!shopId) {
      const catalog = await fetchCatalogProduct(productId);
      if (!catalog) {
        logger.warn(
          { product_id: productId },
          'inventory mirror reconcile: no snapshot and catalog fetch failed',
        );
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
      healedSnapshots += 1;
      shopId = catalog.shopId;
      logger.info(
        { product_id: productId, shop_id: shopId },
        'inventory mirror reconcile: healed missing product snapshot from catalog',
      );
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
      correlationId: `inventory-mirror-reconcile:${productId}:${Date.now()}`,
    });
    published += 1;
  }

  return { scanned: productIds.length, healedSnapshots, published, skipped };
};

export const startInventoryMirrorReconcileJob = () => {
  const intervalMs = env.INVENTORY_MIRROR_RECONCILE_INTERVAL_MS;
  if (intervalMs <= 0) {
    logger.info('inventory mirror reconcile job disabled');
    return;
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runInventoryMirrorReconcile();
      if (result.scanned > 0) {
        logger.info({ ...result }, 'inventory mirror reconcile tick');
      }
    } catch (error) {
      logger.error({ err: error }, 'inventory mirror reconcile failed');
    } finally {
      running = false;
    }
  };

  // First run shortly after boot so prod heals without waiting a full interval.
  setTimeout(() => {
    void tick();
  }, 15_000);
  setInterval(() => {
    void tick();
  }, intervalMs);

  logger.info({ interval_ms: intervalMs }, 'inventory mirror reconcile job started');
};
