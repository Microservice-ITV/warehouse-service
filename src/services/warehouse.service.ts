import { Prisma } from '@prisma/client';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { ConflictError, NotFoundError } from '@/utils/errors';
import logger from '@/utils/logger';

export class WarehouseService {
  private readonly warehouseRepository = new WarehouseRepository();

  async createWarehouse(input: {
    name: string;
    code?: string | null;
    address?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
    createdBy?: string | null;
  }) {
    return this.warehouseRepository.create({
      name: input.name,
      code: input.code ?? null,
      address: input.address ?? null,
      status: input.status ?? 'ACTIVE',
      createdBy: input.createdBy ?? null,
    });
  }

  async updateWarehouse(
    id: string,
    input: { name?: string; code?: string | null; address?: string | null; status?: 'ACTIVE' | 'INACTIVE' },
    createdBy?: string
  ) {
    const existing = await this.warehouseRepository.findById(id);
    if (!existing || (createdBy && existing.createdBy !== createdBy)) {
      throw new NotFoundError('Warehouse not found');
    }
    return this.warehouseRepository.updateById(id, input);
  }

  async getWarehouse(id: string, createdBy?: string) {
    const warehouse = await this.warehouseRepository.findById(id);
    if (!warehouse || (createdBy && warehouse.createdBy !== createdBy)) {
      throw new NotFoundError('Warehouse not found');
    }
    return warehouse;
  }

  async listWarehouses(params: { status?: 'ACTIVE' | 'INACTIVE'; createdBy?: string } = {}) {
    return this.warehouseRepository.list(params);
  }

  async deleteWarehouse(id: string, createdBy?: string) {
    const existing = await this.warehouseRepository.findById(id);
    if (!existing || (createdBy && existing.createdBy !== createdBy)) {
      throw new NotFoundError('Warehouse not found');
    }
    try {
      await this.warehouseRepository.deleteById(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictError('This warehouse has inventory history and cannot be deleted.');
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
