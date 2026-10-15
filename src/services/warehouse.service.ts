import type { Warehouse } from '@prisma/client';
import { Prisma } from '@prisma/client';
import prisma from '@/config/database';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { ConflictError, NotFoundError } from '@/utils/errors';
import logger from '@/utils/logger';
import {
  capacitySnapshot,
  type WarehouseCapacityFields,
  type WarehouseCapacitySnapshot,
} from '@/utils/warehouseCapacity';

export type WarehouseWithCapacity = Warehouse & WarehouseCapacitySnapshot;

const asCapacityFields = (warehouse: Warehouse): WarehouseCapacityFields => ({
  id: warehouse.id,
  name: warehouse.name,
  capacityUnits:
    'capacityUnits' in warehouse
      ? ((warehouse as WarehouseCapacityFields).capacityUnits ?? null)
      : null,
});

const actorOwnsWarehouse = (
  warehouse: Pick<Warehouse, 'createdBy' | 'sellerUserId'>,
  ownerUserIds?: string[],
) => {
  if (!ownerUserIds || ownerUserIds.length === 0) return true;
  const owners = new Set(ownerUserIds);
  return (
    (!!warehouse.createdBy && owners.has(warehouse.createdBy)) ||
    (!!warehouse.sellerUserId && owners.has(warehouse.sellerUserId))
  );
};

export class WarehouseService {
  private readonly warehouseRepository = new WarehouseRepository();

  private async withCapacity(warehouse: Warehouse): Promise<WarehouseWithCapacity> {
    const aggregate = await prisma.inventoryStock.aggregate({
      where: { warehouseId: warehouse.id },
      _sum: { onHandQty: true },
    });
    return {
      ...warehouse,
      ...capacitySnapshot(asCapacityFields(warehouse), aggregate._sum.onHandQty ?? 0),
    };
  }

  private async withCapacityMany(warehouses: Warehouse[]): Promise<WarehouseWithCapacity[]> {
    if (warehouses.length === 0) return [];
    const usage = await prisma.inventoryStock.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { in: warehouses.map((row) => row.id) } },
      _sum: { onHandQty: true },
    });
    const usedById = new Map(usage.map((row) => [row.warehouseId, row._sum.onHandQty ?? 0]));
    return warehouses.map((warehouse) => ({
      ...warehouse,
      ...capacitySnapshot(asCapacityFields(warehouse), usedById.get(warehouse.id) ?? 0),
    }));
  }

  async createWarehouse(input: {
    name: string;
    code?: string | null;
    address?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
    capacityUnits: number;
    createdBy?: string | null;
    sellerUserId?: string | null;
  }) {
    const warehouse = await this.warehouseRepository.create({
      name: input.name,
      code: input.code ?? null,
      address: input.address ?? null,
      status: input.status ?? 'ACTIVE',
      capacityUnits: input.capacityUnits,
      createdBy: input.createdBy ?? null,
      sellerUserId: input.sellerUserId ?? null,
    });
    return this.withCapacity(warehouse);
  }

  async updateWarehouse(
    id: string,
    input: {
      name?: string;
      code?: string | null;
      address?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
      capacityUnits?: number | null;
    },
    ownerUserIds?: string[],
  ) {
    const existing = await this.warehouseRepository.findById(id);
    if (!existing || !actorOwnsWarehouse(existing, ownerUserIds)) {
      throw new NotFoundError('Warehouse not found');
    }
    const warehouse = await this.warehouseRepository.updateById(id, input);
    return this.withCapacity(warehouse);
  }

  async getWarehouse(id: string, createdBy?: string) {
    const warehouse = await this.warehouseRepository.findById(id);
    if (!warehouse || (createdBy && warehouse.createdBy !== createdBy)) {
      throw new NotFoundError('Warehouse not found');
    }
    return this.withCapacity(warehouse);
  }

  async listWarehouses(
    params: {
      status?: 'ACTIVE' | 'INACTIVE';
      createdBy?: string;
      sellerUserId?: string;
      ownerUserIds?: string[];
    } = {},
  ) {
    const warehouses = await this.warehouseRepository.list(params);
    return this.withCapacityMany(warehouses);
  }

  async deleteWarehouse(id: string, ownerUserIds?: string[]) {
    const existing = await this.warehouseRepository.findById(id);
    if (!existing || !actorOwnsWarehouse(existing, ownerUserIds)) {
      throw new NotFoundError('Warehouse not found');
    }

    const productRows = await prisma.inventoryStock.count({
      where: {
        warehouseId: id,
        OR: [{ onHandQty: { gt: 0 } }, { reservedQty: { gt: 0 } }, { availableQty: { gt: 0 } }],
      },
    });
    if (productRows > 0) {
      throw new ConflictError('This warehouse still has products and cannot be deleted.');
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.inventoryMovement.deleteMany({ where: { warehouseId: id } });
        await this.warehouseRepository.deleteById(id, tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictError('This warehouse still has products and cannot be deleted.');
      }
      throw error;
    }
  }

  async syncFromShopCreated(input: { shopId: string; name?: string; isActive?: boolean }) {
    logger.warn(
      { shopId: input.shopId },
      'shop.created: no warehouse sync, warehouses are not shop-scoped'
    );
  }

  async syncFromShopUpdated(input: { shopId: string; name?: string; isActive?: boolean }) {
    logger.warn(
      { shopId: input.shopId },
      'shop.updated: no warehouse sync, warehouses are not shop-scoped'
    );
  }

  async syncFromShopDeleted(input: { shopId: string }) {
    logger.warn(
      { shopId: input.shopId },
      'shop.deleted: no warehouse sync, warehouses are not shop-scoped'
    );
  }
}
