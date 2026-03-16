import type { Prisma, Warehouse } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class WarehouseRepository {
  async create(data: {
    shopId: string;
    name: string;
    location?: string;
  }, db: Db = prisma): Promise<Warehouse> {
    return db.warehouse.create({ data });
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
}
