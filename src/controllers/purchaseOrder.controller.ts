import type { Request, Response } from 'express';
import { PurchaseOrderService } from '@/services/purchaseOrder.service';
import { ValidationError } from '@/utils/errors';
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
  const data = await purchaseOrderService.list(parsed.data);
  return res.status(200).json({ success: true, data });
};

export const getPurchaseOrder = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.params.id);
  return res.status(200).json({ success: true, data: order });
};

export const updatePurchaseOrderStatus = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.setStatus(req.params.id, {
    ...req.body,
    changedBy: req.user?.sub,
  });
  return res.status(200).json({ success: true, data: order });
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
