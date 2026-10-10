import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { NotFoundError } from '@/utils/errors';
import logger from '@/utils/logger';

export class WarehouseService {
  private readonly warehouseRepository = new WarehouseRepository();

  async createWarehouse(input: {
    name: string;
    code?: string | null;
    address?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    return this.warehouseRepository.create({
      name: input.name,
      code: input.code ?? null,
      address: input.address ?? null,
      status: input.status ?? 'ACTIVE',
    });
  }

  async updateWarehouse(
    id: string,
    input: { name?: string; code?: string | null; address?: string | null; status?: 'ACTIVE' | 'INACTIVE' }
  ) {
    const existing = await this.warehouseRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('Warehouse not found');
    }
    return this.warehouseRepository.updateById(id, input);
  }

  async getWarehouse(id: string) {
    const warehouse = await this.warehouseRepository.findById(id);
    if (!warehouse) {
      throw new NotFoundError('Warehouse not found');
    }
    return warehouse;
  }

  async listWarehouses(params: { status?: 'ACTIVE' | 'INACTIVE' } = {}) {
    return this.warehouseRepository.list(params);
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
