import type { Request, Response } from 'express';
import { PurchaseOrderService } from '@/services/purchaseOrder.service';
import { AppError, ValidationError } from '@/utils/errors';
import {
  assertOwnedWarehouse,
  assertWarehouseManager,
  isPlatformAdmin,
  isWarehouseManager,
  ownedWarehouseIds,
  requestUserId,
} from '@/utils/warehouseAccess';
import { listPurchaseOrdersQuerySchema } from '@/validators/purchase.validators';

const purchaseOrderService = new PurchaseOrderService();

export const createPurchaseOrder = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.create({
    ...req.body,
    createdBy: req.user?.sub,
  });
  return res.status(201).json({ success: true, data: order });
};

export const listPurchaseOrders = async (req: Request, res: Response) => {
  const parsed = listPurchaseOrdersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const warehouseIds = await ownedWarehouseIds(req);
  const createdByIds =
    req.user && !isPlatformAdmin(req) && !isWarehouseManager(req)
      ? [
          ...new Set(
            [requestUserId(req), typeof req.user.sub === 'string' ? req.user.sub.trim() : '']
              .filter((id): id is string => Boolean(id)),
          ),
        ]
      : undefined;
  const data = await purchaseOrderService.list({ ...parsed.data, warehouseIds, createdByIds });
  return res.status(200).json({ success: true, data });
};

export const getPurchaseOrder = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.params.id);
  assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));
  return res.status(200).json({ success: true, data: order });
};

export const downloadPurchaseOrderAttachment = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.params.id);
  assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));
  const file = await purchaseOrderService.getAttachment(req.params.id, req.params.attachmentId);
  const fileName = file.fileName.replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(file.sizeBytes));
  return res.status(200).send(file.content);
};

export const receiveSupplierOrder = async (req: Request, res: Response) => {
  assertWarehouseManager(req, 'Only a warehouse manager can receive supplier products');
  const order = await purchaseOrderService.get(req.params.id);
  assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));
  const data = await purchaseOrderService.receiveSupplierStock(req.params.id, req.user?.sub);
  return res.status(200).json({ success: true, data });
};

export const updatePurchaseOrderStatus = async (req: Request, res: Response) => {
  if (req.body.status === 'APPROVED') {
    assertWarehouseManager(req, 'Only a warehouse manager can approve a purchase order');
  }
  if (req.body.status === 'RESTOCK_REQUESTED') {
    assertWarehouseManager(req, 'Only a warehouse manager can request a restock');
  }
  if (req.body.status === 'RESTOCK_APPROVED') {
    if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req)) {
      throw new AppError('Only the seller can approve a restock request', 403, 'FORBIDDEN');
    }
  }
  const order = await purchaseOrderService.get(req.params.id);
  assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));
  const updated = await purchaseOrderService.setStatus(req.params.id, {
    ...req.body,
    changedBy: req.user?.sub,
  });
  return res.status(200).json({ success: true, data: updated });
};

// --- Delivery stages ---------------------------------------------------------

export const listDeliveryStages = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.listDeliveryStages(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const createDeliveryStage = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.createDeliveryStage(req.params.id, req.body);
  return res.status(201).json({ success: true, data });
};

// --- Additional costs --------------------------------------------------------

export const listAdditionalCosts = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.listAdditionalCosts(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const createAdditionalCost = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.createAdditionalCost(req.params.id, req.body);
  return res.status(201).json({ success: true, data });
};

// --- Cost adjustments --------------------------------------------------------

export const listCostAdjustments = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.listCostAdjustments(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const createCostAdjustment = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.createCostAdjustment(req.params.id, {
    ...req.body,
    createdBy: req.user?.sub,
  });
  return res.status(201).json({ success: true, data });
};

export const applyCostAdjustment = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.applyCostAdjustment(req.params.id);
  return res.status(200).json({ success: true, data });
};
