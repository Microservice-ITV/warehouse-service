import type { Request, Response } from 'express';
import { PurchaseOrderService } from '@/services/purchaseOrder.service';
import { AppError, ValidationError } from '@/utils/errors';
import { listPurchaseOrdersQuerySchema } from '@/validators/purchase.validators';

const purchaseOrderService = new PurchaseOrderService();

const PLATFORM_ADMIN_ROLES = new Set([
  'super_admin',
  'platform_super_admin',
  'platform_finance',
  'platform_director',
  'platform_cfo',
]);

const isPlatformAdmin = (req: Request): boolean => {
  const role = req.user && 'role' in req.user ? req.user.role : undefined;
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PLATFORM_ADMIN_ROLES.has(normalized);
};

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

export const downloadPurchaseOrderAttachment = async (req: Request, res: Response) => {
  const file = await purchaseOrderService.getAttachment(req.params.id, req.params.attachmentId);
  const fileName = file.fileName.replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(file.sizeBytes));
  return res.status(200).send(file.content);
};

export const updatePurchaseOrderStatus = async (req: Request, res: Response) => {
  if (req.body.status === 'APPROVED' && req.user && !isPlatformAdmin(req)) {
    throw new AppError('Only an admin can approve a purchase order', 403, 'FORBIDDEN');
  }
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
