import type { Request, Response } from 'express';
import { InventoryService } from '@/services/inventory.service';

const inventoryService = new InventoryService();

export const getWarehouseInventory = async (req: Request, res: Response) => {
  const data = await inventoryService.listWarehouseInventory(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const increaseStock = async (req: Request, res: Response) => {
  const data = await inventoryService.increaseStock(req.body);
  return res.status(200).json({ success: true, data });
};

export const adjustStock = async (req: Request, res: Response) => {
  const data = await inventoryService.adjustStock(req.body);
  return res.status(200).json({ success: true, data });
};

export const getStockMovements = async (req: Request, res: Response) => {
  const data = await inventoryService.listMovements({
    productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
    warehouseId: typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined,
    limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
  });
  return res.status(200).json({ success: true, data });
};

export const validateProductStock = async (req: Request, res: Response) => {
  const data = await inventoryService.validateProductStock(req.body);
  return res.status(200).json({ success: true, data });
};

export const transferStock = async (req: Request, res: Response) => {
  const data = await inventoryService.transferStock(req.body);
  return res.status(200).json({ success: true, data });
};

export const countStock = async (req: Request, res: Response) => {
  const data = await inventoryService.countStock(req.body);
  return res.status(200).json({ success: true, data });
};

export const receiveStock = async (req: Request, res: Response) => {
  const data = await inventoryService.receiveStock(req.body);
  return res.status(200).json({ success: true, data });
};
