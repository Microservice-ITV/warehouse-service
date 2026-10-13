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

  async listByReference(
    referenceId: string,
    movementType: MovementType,
    db?: Db,
  ): Promise<InventoryMovement[]> {
    const client = db ?? prisma;
    return client.inventoryMovement.findMany({
      where: { referenceId, movementType },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countByReference(referenceId: string, db?: Db): Promise<number> {
    const client = db ?? prisma;
    return client.inventoryMovement.count({ where: { referenceId } });
  }

  async list(params: {
    productId?: string;
    warehouseId?: string;
    warehouseIds?: string[];
    movementType?: MovementType;
    limit?: number;
    or?: Prisma.InventoryMovementWhereInput[];
  }): Promise<InventoryMovement[]> {
    const and: Prisma.InventoryMovementWhereInput[] = [];
    if (params.productId) and.push({ productId: params.productId });
    if (params.warehouseId) and.push({ warehouseId: params.warehouseId });
    if (params.warehouseIds) and.push({ warehouseId: { in: params.warehouseIds } });
    if (params.movementType) and.push({ movementType: params.movementType });
    if (params.or) and.push(params.or.length > 0 ? { OR: params.or } : { id: { in: [] } });
    return prisma.inventoryMovement.findMany({
      where: and.length > 0 ? { AND: and } : {},
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }
}
