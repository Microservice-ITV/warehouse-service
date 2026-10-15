import type { Prisma, Warehouse } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export type WarehouseStatusValue = 'ACTIVE' | 'INACTIVE';

export class WarehouseRepository {
  async create(
    data: {
      name: string;
      code?: string | null;
      address?: string | null;
      status?: WarehouseStatusValue;
      capacityUnits?: number | null;
      createdBy?: string | null;
      sellerUserId?: string | null;
    },
    db: Db = prisma
  ): Promise<Warehouse> {
    return db.warehouse.create({ data });
  }

  async updateById(
    id: string,
    data: {
      name?: string;
      code?: string | null;
      address?: string | null;
      status?: WarehouseStatusValue;
      capacityUnits?: number | null;
    },
    db: Db = prisma
  ): Promise<Warehouse> {
    return db.warehouse.update({ where: { id }, data });
  }

  async findById(id: string, db: Db = prisma): Promise<Warehouse | null> {
    return db.warehouse.findUnique({ where: { id } });
  }

  async listIdsByCreatedBy(createdBy: string, db: Db = prisma): Promise<string[]> {
    const rows = await db.warehouse.findMany({
      where: { createdBy },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listIdsBySellerUserId(sellerUserId: string, db: Db = prisma): Promise<string[]> {
    const rows = await db.warehouse.findMany({
      where: { sellerUserId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async deleteById(id: string, db: Db = prisma): Promise<Warehouse> {
    return db.warehouse.delete({ where: { id } });
  }

  async list(
    params: {
      status?: WarehouseStatusValue;
      createdBy?: string;
      sellerUserId?: string;
      /** Match warehouses owned as manager or as creating seller. */
      ownerUserIds?: string[];
    } = {},
    db: Db = prisma
  ): Promise<Warehouse[]> {
    const ownerIds = (params.ownerUserIds ?? []).map((id) => id.trim()).filter(Boolean);
    return db.warehouse.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.createdBy ? { createdBy: params.createdBy } : {}),
        ...(params.sellerUserId ? { sellerUserId: params.sellerUserId } : {}),
        ...(ownerIds.length > 0
          ? {
              OR: [{ createdBy: { in: ownerIds } }, { sellerUserId: { in: ownerIds } }],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
