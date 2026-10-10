import type { Prisma, TransferStatus, WarehouseTransfer } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class TransferRepository {
  async create(
    params: {
      fromWarehouseId: string;
      toWarehouseId: string;
      productId: string;
      variantId?: string;
      quantity: number;
      referenceId?: string | null;
      referenceType?: string | null;
      requestedBy?: string | null;
      db?: Db;
    }
  ): Promise<WarehouseTransfer> {
    const db = params.db ?? prisma;
    return db.warehouseTransfer.create({
      data: {
        fromWarehouseId: params.fromWarehouseId,
        toWarehouseId: params.toWarehouseId,
        productId: params.productId,
        variantId: params.variantId ?? '',
        quantity: params.quantity,
        referenceId: params.referenceId ?? null,
        referenceType: params.referenceType ?? null,
        requestedBy: params.requestedBy ?? null,
      },
    });
  }

  async findById(id: string, db: Db = prisma): Promise<WarehouseTransfer | null> {
    return db.warehouseTransfer.findUnique({ where: { id } });
  }

  async list(
    params: {
      warehouseId?: string;
      status?: TransferStatus;
      limit?: number;
    },
    db: Db = prisma
  ): Promise<WarehouseTransfer[]> {
    return db.warehouseTransfer.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.warehouseId
          ? {
              OR: [
                { fromWarehouseId: params.warehouseId },
                { toWarehouseId: params.warehouseId },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async decide(
    id: string,
    params: {
      status: TransferStatus;
      decidedBy?: string | null;
      note?: string | null;
    },
    db: Db = prisma
  ): Promise<WarehouseTransfer> {
    return db.warehouseTransfer.update({
      where: { id },
      data: {
        status: params.status,
        decidedBy: params.decidedBy ?? null,
        decidedAt: new Date(),
        note: params.note ?? null,
      },
    });
  }
}