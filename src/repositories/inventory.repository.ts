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
        reservedStock: 0,
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

  async lockCandidatesForReservation(params: {
    productId: string;
    shopId: string;
    db: Prisma.TransactionClient;
  }): Promise<Array<{ id: string; warehouseId: string; availableStock: number; reservedStock: number }>> {
    const rows = await params.db.$queryRaw<
      Array<{ id: string; warehouseId: string; availableStock: number; reservedStock: number }>
    >`
      SELECT i.id, i."warehouseId", i."availableStock", i."reservedStock"
      FROM inventories i
      INNER JOIN warehouses w ON w.id = i."warehouseId"
      WHERE i."productId" = ${params.productId}
        AND w."shopId" = ${params.shopId}
        AND w.status = 'ACTIVE'
      ORDER BY i."availableStock" DESC
      FOR UPDATE
    `;
    return rows;
  }

  async incrementStocks(params: {
    warehouseId: string;
    productId: string;
    availableDelta?: number;
    reservedDelta?: number;
    db: Prisma.TransactionClient;
  }) {
    const { warehouseId, productId, availableDelta = 0, reservedDelta = 0, db } = params;
    return db.inventory.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: {
        availableStock: { increment: availableDelta },
        reservedStock: { increment: reservedDelta },
      },
    });
  }

  async computeTotalStockByShopProduct(shopId: string, productId: string, db: Db = prisma) {
    const aggregate = await db.inventory.aggregate({
      where: { productId, warehouse: { shopId } },
      _sum: { availableStock: true, reservedStock: true },
    });
    return {
      available: aggregate._sum.availableStock ?? 0,
      reserved: aggregate._sum.reservedStock ?? 0,
      total: (aggregate._sum.availableStock ?? 0) + (aggregate._sum.reservedStock ?? 0),
    };
  }

  async computeTotalsByProductIds(
    productIds: string[],
    db: Db = prisma
  ): Promise<Map<string, { available: number; reserved: number; total: number }>> {
    if (productIds.length === 0) return new Map();

    const rows = await db.$queryRaw<
      Array<{ productId: string; available: number; reserved: number }>
    >`
      SELECT
        i."productId" AS "productId",
        COALESCE(SUM(i."availableStock"), 0)::int AS "available",
        COALESCE(SUM(i."reservedStock"), 0)::int AS "reserved"
      FROM inventories i
      INNER JOIN warehouses w ON w.id = i."warehouseId"
      WHERE i."productId" IN (${Prisma.join(productIds)})
        AND w.status = 'ACTIVE'
      GROUP BY i."productId"
    `;

    return new Map(
      rows.map((row) => [
        row.productId,
        {
          available: Number(row.available) || 0,
          reserved: Number(row.reserved) || 0,
          total: (Number(row.available) || 0) + (Number(row.reserved) || 0),
        },
      ])
    );
  }
}
