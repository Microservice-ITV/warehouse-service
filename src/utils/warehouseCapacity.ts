import type { Prisma } from '@prisma/client';
import prisma from '@/config/database';
import { ValidationError } from '@/utils/errors';

type Db = Prisma.TransactionClient | typeof prisma;

export type WarehouseCapacityFields = {
  id: string;
  name: string;
  capacityUnits?: number | null;
};

export type WarehouseCapacitySnapshot = {
  capacityUnits: number | null;
  usedUnits: number;
  remainingUnits: number | null;
  isAtCapacity: boolean;
};

export const sumOnHandQty = async (warehouseId: string, db: Db = prisma): Promise<number> => {
  const aggregate = await db.inventoryStock.aggregate({
    where: { warehouseId },
    _sum: { onHandQty: true },
  });
  return aggregate._sum.onHandQty ?? 0;
};

export const capacitySnapshot = (
  warehouse: Pick<WarehouseCapacityFields, 'capacityUnits'>,
  usedUnits: number,
): WarehouseCapacitySnapshot => {
  const capacityUnits = warehouse.capacityUnits ?? null;
  if (capacityUnits == null) {
    return {
      capacityUnits: null,
      usedUnits,
      remainingUnits: null,
      isAtCapacity: false,
    };
  }
  const remainingUnits = Math.max(0, capacityUnits - usedUnits);
  return {
    capacityUnits,
    usedUnits,
    remainingUnits,
    isAtCapacity: usedUnits >= capacityUnits,
  };
};

export const getWarehouseCapacitySnapshot = async (
  warehouse: WarehouseCapacityFields,
  db: Db = prisma,
): Promise<WarehouseCapacitySnapshot> => {
  const usedUnits = await sumOnHandQty(warehouse.id, db);
  return capacitySnapshot(warehouse, usedUnits);
};

/**
 * Blocks inbound stock / orders when the warehouse has no room left for `additionalUnits`.
 */
export const assertWarehouseCanAcceptUnits = async (
  warehouse: WarehouseCapacityFields,
  additionalUnits: number,
  action: 'purchase' | 'transfer' | 'receive',
  db: Db = prisma,
): Promise<WarehouseCapacitySnapshot> => {
  const snapshot = await getWarehouseCapacitySnapshot(warehouse, db);
  if (snapshot.capacityUnits == null) return snapshot;

  const name = warehouse.name?.trim() || 'This warehouse';
  const usedLabel = `${snapshot.usedUnits}/${snapshot.capacityUnits} units`;

  if (snapshot.isAtCapacity) {
    if (action === 'purchase') {
      throw new ValidationError(
        `${name} is at full capacity (${usedLabel}). You cannot place a purchase order for this warehouse until space is available.`,
      );
    }
    if (action === 'transfer') {
      throw new ValidationError(
        `${name} is at full capacity (${usedLabel}). You cannot transfer stock into this warehouse until space is available.`,
      );
    }
    throw new ValidationError(
      `${name} is at full capacity (${usedLabel}). You cannot receive stock into this warehouse until space is available.`,
    );
  }

  const incoming = Math.max(0, additionalUnits);
  if (incoming > 0 && snapshot.usedUnits + incoming > snapshot.capacityUnits) {
    const remaining = snapshot.remainingUnits ?? 0;
    if (action === 'purchase') {
      throw new ValidationError(
        `${name} only has ${remaining} units of capacity remaining (${usedLabel}). Reduce the order quantity or choose another warehouse.`,
      );
    }
    if (action === 'transfer') {
      throw new ValidationError(
        `${name} only has ${remaining} units of capacity remaining (${usedLabel}). Reduce the transfer quantity or choose another warehouse.`,
      );
    }
    throw new ValidationError(
      `${name} only has ${remaining} units of capacity remaining (${usedLabel}). Reduce the quantity or free space before receiving.`,
    );
  }

  return snapshot;
};
