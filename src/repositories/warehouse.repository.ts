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
    },
    db: Db = prisma
  ): Promise<Warehouse> {
    return db.warehouse.create({ data });
  }

  async updateById(
    id: string,
    data: { name?: string; code?: string | null; address?: string | null; status?: WarehouseStatusValue },
    db: Db = prisma
  ): Promise<Warehouse> {
    return db.warehouse.update({ where: { id }, data });
  }

  async findById(id: string, db: Db = prisma): Promise<Warehouse | null> {
    return db.warehouse.findUnique({ where: { id } });
  }

  async list(
    params: { status?: WarehouseStatusValue } = {},
    db: Db = prisma
  ): Promise<Warehouse[]> {
    return db.warehouse.findMany({
      where: params.status ? { status: params.status } : undefined,
      orderBy: { name: 'asc' },
    });
  }
}
