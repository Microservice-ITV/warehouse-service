import type { InventoryMovement, MovementType, Prisma } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class MovementRepository {
  async create(
    params: {
      warehouseId: string;
      productId: string;
      variantId?: string;
      movementType: MovementType;
      quantity: number;
      beforeQty: number;
      afterQty: number;
      referenceType?: string | null;
      referenceId?: string | null;
      unitCost?: number | null;
      createdBy?: string | null;
      db?: Db;
    }
  ): Promise<InventoryMovement> {
    const db = params.db ?? prisma;
    return db.inventoryMovement.create({
      data: {
        warehouseId: params.warehouseId,
        productId: params.productId,
        variantId: params.variantId ?? '',
        movementType: params.movementType,
        quantity: params.quantity,
        beforeQty: params.beforeQty,
        afterQty: params.afterQty,
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        unitCost: params.unitCost ?? null,
        createdBy: params.createdBy ?? null,
      },
    });
  }

  async countByReference(referenceId: string, db?: Db): Promise<number> {
    const client = db ?? prisma;
    return client.inventoryMovement.count({ where: { referenceId } });
  }

  async list(params: {
    productId?: string;
    warehouseId?: string;
    movementType?: MovementType;
    limit?: number;
  }): Promise<InventoryMovement[]> {
    return prisma.inventoryMovement.findMany({
      where: {
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
        ...(params.movementType ? { movementType: params.movementType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }
}
