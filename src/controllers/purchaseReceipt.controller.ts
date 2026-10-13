import type { Request, Response } from 'express';
import { PurchaseReceiptService } from '@/services/purchaseReceipt.service';
import { PurchaseOrderService } from '@/services/purchaseOrder.service';
import { ValidationError } from '@/utils/errors';
import {
  assertOwnedWarehouse,
  assertWarehouseManager,
  ownedWarehouseIds,
} from '@/utils/warehouseAccess';
import { listPurchaseReceiptsQuerySchema } from '@/validators/purchase.validators';

const purchaseReceiptService = new PurchaseReceiptService();
const purchaseOrderService = new PurchaseOrderService();

export const createPurchaseReceipt = async (req: Request, res: Response) => {
  assertWarehouseManager(req, 'Only a warehouse manager can receive goods');
  const order = await purchaseOrderService.get(req.body.purchaseOrderId);
  const ownedIds = await ownedWarehouseIds(req);
  assertOwnedWarehouse(order.warehouseId, ownedIds);
  assertOwnedWarehouse(req.body.warehouseId ?? order.warehouseId, ownedIds);
  const receipt = await purchaseReceiptService.create({
    ...req.body,
    createdBy: req.body.createdBy ?? req.user?.sub,
  });
  return res.status(201).json({ success: true, data: receipt });
};

export const listPurchaseReceipts = async (req: Request, res: Response) => {
  const parsed = listPurchaseReceiptsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const data = await purchaseReceiptService.list({
    ...parsed.data,
    warehouseIds: await ownedWarehouseIds(req),
  });
  return res.status(200).json({ success: true, data });
};

export const getPurchaseReceipt = async (req: Request, res: Response) => {
  const receipt = await purchaseReceiptService.get(req.params.id);
  assertOwnedWarehouse(receipt.warehouseId, await ownedWarehouseIds(req));
  return res.status(200).json({ success: true, data: receipt });
};

export const confirmPurchaseReceipt = async (req: Request, res: Response) => {
  assertWarehouseManager(req, 'Only a warehouse manager can receive goods');
  const receipt = await purchaseReceiptService.get(req.params.id);
  assertOwnedWarehouse(receipt.warehouseId, await ownedWarehouseIds(req));
  const confirmed = await purchaseReceiptService.confirm(req.params.id);
  return res.status(200).json({ success: true, data: confirmed });
};