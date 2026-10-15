import { Prisma, type InventoryStock } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class InventoryRepository {
  async ensureRow(
    warehouseId: string,
    productId: string,
    variantId: string,
    db: Db = prisma
  ): Promise<InventoryStock> {
    const existing = await this.findByKey(warehouseId, productId, variantId, db);
    if (existing) return existing;

    try {
      return await db.inventoryStock.create({
        data: { warehouseId, productId, variantId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findByKey(warehouseId, productId, variantId, db);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async findByKey(
    warehouseId: string,
    productId: string,
    variantId: string,
    db: Db = prisma
  ): Promise<InventoryStock | null> {
    return db.inventoryStock.findUnique({
      where: {
        warehouseId_productId_variantId: { warehouseId, productId, variantId },
      },
    });
  }

  async lockByKey(
    warehouseId: string,
    productId: string,
    variantId: string,
    tx: Prisma.TransactionClient
  ): Promise<InventoryStock> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        warehouse_id: string;
        product_id: string;
        variant_id: string;
        on_hand_qty: number;
        reserved_qty: number;
        available_qty: number;
        updated_at: Date;
      }>
    >`
      SELECT *
      FROM inventory_stocks
      WHERE "warehouse_id" = ${warehouseId}
        AND "product_id" = ${productId}
        AND "variant_id" = ${variantId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(
        `Inventory stock row missing while locked: ${warehouseId}/${productId}/${variantId}`
      );
    }
    return {
      id: row.id,
      warehouseId: row.warehouse_id,
      productId: row.product_id,
      variantId: row.variant_id,
      onHandQty: Number(row.on_hand_qty),
      reservedQty: Number(row.reserved_qty),
      availableQty: Number(row.available_qty),
      updatedAt: row.updated_at,
    };
  }

  async setQuantities(
    id: string,
    quantities: { onHandQty: number; reservedQty: number; availableQty: number },
    db: Db = prisma
  ): Promise<InventoryStock> {
    return db.inventoryStock.update({ where: { id }, data: quantities });
  }

  async listByWarehouse(warehouseId: string, db: Db = prisma): Promise<InventoryStock[]> {
    return db.inventoryStock.findMany({
      where: { warehouseId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listByProduct(productId: string, db: Db = prisma): Promise<InventoryStock[]> {
    return db.inventoryStock.findMany({ where: { productId } });
  }

  async listByProductInWarehouse(
    warehouseId: string,
    productId: string,
    db: Db = prisma
  ): Promise<InventoryStock[]> {
    return db.inventoryStock.findMany({
      where: { warehouseId, productId },
    });
  }

  async computeTotalsByProductId(
    productId: string,
    db: Db = prisma
  ): Promise<{ available: number; total: number }> {
    const aggregate = await db.inventoryStock.aggregate({
      where: { productId },
      _sum: { availableQty: true, onHandQty: true },
    });
    return {
      available: aggregate._sum.availableQty ?? 0,
      total: aggregate._sum.onHandQty ?? 0,
    };
  }

  /** Per inventory variantId row totals for one product (all warehouses). */
  async listVariantTotalsByProductId(
    productId: string,
    db: Db = prisma
  ): Promise<Array<{ variantId: string; available: number; total: number }>> {
    const rows = await db.inventoryStock.groupBy({
      by: ['variantId'],
      where: { productId },
      _sum: { availableQty: true, onHandQty: true },
    });
    return rows.map((row) => ({
      variantId: row.variantId,
      available: row._sum.availableQty ?? 0,
      total: row._sum.onHandQty ?? 0,
    }));
  }

  async computeTotalsByProductIds(
    productIds: string[],
    db: Db = prisma
  ): Promise<Map<string, { available: number; total: number }>> {
    if (productIds.length === 0) return new Map();

    const rows = await db.$queryRaw<
      Array<{ productId: string; available: number; total: number }>
    >`
      SELECT
        s."product_id" AS "productId",
        COALESCE(SUM(s."available_qty"), 0)::int AS "available",
        COALESCE(SUM(s."on_hand_qty"), 0)::int AS "total"
      FROM inventory_stocks s
      INNER JOIN warehouses w ON w.id = s."warehouse_id"
      WHERE s."product_id" IN (${Prisma.join(productIds)})
        AND w.status = 'ACTIVE'
      GROUP BY s."product_id"
    `;

    return new Map(
      rows.map((row) => [
        row.productId,
        {
          available: Number(row.available) || 0,
          total: Number(row.total) || 0,
        },
      ])
    );
  }
}
