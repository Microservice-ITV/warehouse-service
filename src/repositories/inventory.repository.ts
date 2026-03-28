import { Prisma, type Inventory } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class InventoryRepository {
  async upsertByWarehouseAndProduct(
    warehouseId: string,
    productId: string,
    db: Db = prisma
  ): Promise<Inventory> {
    return db.inventory.upsert({
      where: {
        warehouseId_productId: { warehouseId, productId },
      },
      create: {
        warehouseId,
        productId,
        availableStock: 0,
      },
      update: {},
    });
  }

  async listByWarehouse(warehouseId: string, db: Db = prisma) {
    return db.inventory.findMany({ where: { warehouseId }, orderBy: { updatedAt: 'desc' } });
  }

  async findByWarehouseAndProduct(
    warehouseId: string,
    productId: string,
    db: Db = prisma
  ) {
    return db.inventory.findUnique({
      where: { warehouseId_productId: { warehouseId, productId } },
    });
  }

  async incrementStocks(params: {
    warehouseId: string;
    productId: string;
    availableDelta?: number;
    db: Prisma.TransactionClient;
  }) {
    const { warehouseId, productId, availableDelta = 0, db } = params;
    return db.inventory.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: {
        availableStock: { increment: availableDelta },
      },
    });
  }

  async computeTotalStockByShopProduct(shopId: string, productId: string, db: Db = prisma) {
    const aggregate = await db.inventory.aggregate({
      where: { productId, warehouse: { shopId } },
      _sum: { availableStock: true },
    });
    const available = aggregate._sum.availableStock ?? 0;
    return {
      available,
      total: available,
    };
  }

  async computeTotalsByProductIds(
    productIds: string[],
    db: Db = prisma
  ): Promise<Map<string, { available: number; total: number }>> {
    if (productIds.length === 0) return new Map();

    const rows = await db.$queryRaw<
      Array<{ productId: string; available: number }>
    >`
      SELECT
        i."productId" AS "productId",
        COALESCE(SUM(i."availableStock"), 0)::int AS "available"
      FROM inventories i
      INNER JOIN warehouses w ON w.id = i."warehouseId"
      WHERE i."productId" IN (${Prisma.join(productIds)})
        AND w.status = 'ACTIVE'
      GROUP BY i."productId"
    `;

    return new Map(
      rows.map((row) => {
        const available = Number(row.available) || 0;
        return [
          row.productId,
          {
            available,
            total: available,
          },
        ];
      })
    );
  }
}
