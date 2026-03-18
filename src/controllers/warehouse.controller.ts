import type { Request, Response } from 'express';
import { WarehouseService } from '@/services/warehouse.service';
import { ValidationError } from '@/utils/errors';
import { listWarehousesQuerySchema } from '@/validators/warehouse.validators';

const warehouseService = new WarehouseService();

export const createWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.createWarehouse(req.body);
  return res.status(201).json({ success: true, data: warehouse });
};

export const updateWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.updateWarehouse(req.params.id, req.body);
  return res.status(200).json({ success: true, data: warehouse });
};

export const getWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.getWarehouse(req.params.id);
  return res.status(200).json({ success: true, data: warehouse });
};

export const listWarehouses = async (req: Request, res: Response) => {
  const parsed = listWarehousesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const data = await warehouseService.listWarehousesByShop(parsed.data.shopId);
  return res.status(200).json({ success: true, data });
};
