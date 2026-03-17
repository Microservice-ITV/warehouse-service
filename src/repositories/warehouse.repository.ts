import type { Prisma, Warehouse } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class WarehouseRepository {
  async create(data: {
    shopId: string;
    name: string;
    location?: string;
    isDefault?: boolean;
    defaultMarker?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
  }, db: Db = prisma): Promise<Warehouse> {
    return db.warehouse.create({ data });
  }

  async updateById(
    id: string,
    data: {
      name?: string;
      location?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
    },
    db: Db = prisma
  ): Promise<Warehouse> {
    return db.warehouse.update({
      where: { id },
      data,
    });
  }

  async findById(id: string, db: Db = prisma): Promise<Warehouse | null> {
    return db.warehouse.findUnique({ where: { id } });
  }

  async findActiveByShop(shopId: string, db: Db = prisma): Promise<Warehouse[]> {
    return db.warehouse.findMany({
      where: { shopId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findDefaultByShop(shopId: string, db: Db = prisma): Promise<Warehouse | null> {
    return db.warehouse.findFirst({
      where: { shopId, isDefault: true },
    });
  }

  async updateByShop(
    shopId: string,
    data: { status?: 'ACTIVE' | 'INACTIVE' },
    db: Db = prisma
  ) {
    return db.warehouse.updateMany({
      where: { shopId },
      data,
    });
  }
}
