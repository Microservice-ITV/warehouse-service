import { Prisma } from '@prisma/client';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { ConflictError, NotFoundError } from '@/utils/errors';

export class WarehouseService {
  private readonly warehouseRepository = new WarehouseRepository();

  async createWarehouse(input: {
    shopId: string;
    name: string;
    location?: string;
    isDefault?: boolean;
  }) {
    try {
      return await this.warehouseRepository.create({
        shopId: input.shopId,
        name: input.name,
        location: input.location,
        isDefault: Boolean(input.isDefault),
        defaultMarker: input.isDefault ? input.shopId : null,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.isDefault
      ) {
        throw new ConflictError(`Default warehouse already exists for shop: ${input.shopId}`);
      }
      throw error;
    }
  }

  async ensureDefaultWarehouse(shopId: string, preferredName?: string, isActive = true) {
    const existing = await this.warehouseRepository.findDefaultByShop(shopId);
    if (existing) {
      const patch: { name?: string; status?: 'ACTIVE' | 'INACTIVE' } = {};
      if (preferredName && existing.name !== preferredName) patch.name = preferredName;
      const targetStatus = isActive ? 'ACTIVE' : 'INACTIVE';
      if (existing.status !== targetStatus) patch.status = targetStatus;
      if (Object.keys(patch).length > 0) {
        return this.warehouseRepository.updateById(existing.id, patch);
      }
      return existing;
    }

    try {
      return await this.warehouseRepository.create({
        shopId,
        name: preferredName || `Default Warehouse (${shopId.slice(0, 8)})`,
        isDefault: true,
        defaultMarker: shopId,
        status: isActive ? 'ACTIVE' : 'INACTIVE',
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.warehouseRepository.findDefaultByShop(shopId);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async updateWarehouse(
    id: string,
    input: { name?: string; location?: string | null; status?: 'ACTIVE' | 'INACTIVE' }
  ) {
    const existing = await this.warehouseRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('Warehouse not found');
    }
    return this.warehouseRepository.updateById(id, input);
  }

  async syncFromShopCreated(input: { shopId: string; name?: string; isActive?: boolean }) {
    const defaultName = input.name ? `${input.name} - Main Warehouse` : undefined;
    return this.ensureDefaultWarehouse(input.shopId, defaultName, input.isActive !== false);
  }

  async syncFromShopUpdated(input: { shopId: string; name?: string; isActive?: boolean }) {
    const defaultName = input.name ? `${input.name} - Main Warehouse` : undefined;
    await this.ensureDefaultWarehouse(input.shopId, defaultName, input.isActive !== false);
    if (input.isActive !== undefined) {
      await this.warehouseRepository.updateByShop(input.shopId, {
        status: input.isActive ? 'ACTIVE' : 'INACTIVE',
      });
    }
  }

  async syncFromShopDeleted(input: { shopId: string }) {
    await this.warehouseRepository.updateByShop(input.shopId, { status: 'INACTIVE' });
  }

  async getWarehouse(id: string) {
    const warehouse = await this.warehouseRepository.findById(id);
    if (!warehouse) {
      throw new NotFoundError('Warehouse not found');
    }
    return warehouse;
  }
}
