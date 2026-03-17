import type { Request, Response } from 'express';
import { WarehouseService } from '@/services/warehouse.service';

const warehouseService = new WarehouseService();

export const createWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.createWarehouse(req.body);
  return res.status(201).json({ success: true, data: warehouse });
};

export const updateWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.updateWarehouse(req.params.id, req.body);
  return res.status(200).json({ success: true, data: warehouse });
};
