import type { Request, Response } from 'express';
import { PurchaseReturnService } from '@/services/purchaseReturn.service';
import { ValidationError } from '@/utils/errors';
import { assertOwnedWarehouse, ownedWarehouseIds } from '@/utils/warehouseAccess';
import { listPurchaseReturnsQuerySchema } from '@/validators/purchase.validators';

const purchaseReturnService = new PurchaseReturnService();

export const createPurchaseReturn = async (req: Request, res: Response) => {
  assertOwnedWarehouse(req.body.warehouseId, await ownedWarehouseIds(req));
  const purchaseReturn = await purchaseReturnService.create({
    ...req.body,
    createdBy: req.body.createdBy ?? req.user?.sub,
  });
  return res.status(201).json({ success: true, data: purchaseReturn });
};

export const listPurchaseReturns = async (req: Request, res: Response) => {
  const parsed = listPurchaseReturnsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const data = await purchaseReturnService.list({
    ...parsed.data,
    warehouseIds: await ownedWarehouseIds(req),
  });
  return res.status(200).json({ success: true, data });
};

export const getPurchaseReturn = async (req: Request, res: Response) => {
  const purchaseReturn = await purchaseReturnService.get(req.params.id);
  assertOwnedWarehouse(purchaseReturn.warehouseId, await ownedWarehouseIds(req));
  return res.status(200).json({ success: true, data: purchaseReturn });
};

export const postPurchaseReturn = async (req: Request, res: Response) => {
  const existing = await purchaseReturnService.get(req.params.id);
  assertOwnedWarehouse(existing.warehouseId, await ownedWarehouseIds(req));
  const purchaseReturn = await purchaseReturnService.post(req.params.id);
  return res.status(200).json({ success: true, data: purchaseReturn });
};