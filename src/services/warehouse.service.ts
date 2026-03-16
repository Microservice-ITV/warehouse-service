import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { NotFoundError } from '@/utils/errors';

export class WarehouseService {
  private readonly warehouseRepository = new WarehouseRepository();

  async createWarehouse(input: { shopId: string; name: string; location?: string }) {
    return this.warehouseRepository.create(input);
  }

  async getWarehouse(id: string) {
    const warehouse = await this.warehouseRepository.findById(id);
    if (!warehouse) {
      throw new NotFoundError('Warehouse not found');
    }
    return warehouse;
  }
}
