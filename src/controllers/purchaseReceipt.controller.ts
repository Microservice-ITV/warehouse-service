import type { Request, Response } from 'express';
import { PurchaseReceiptService } from '@/services/purchaseReceipt.service';
import { AppError, ValidationError } from '@/utils/errors';
import { listPurchaseReceiptsQuerySchema } from '@/validators/purchase.validators';

const purchaseReceiptService = new PurchaseReceiptService();

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

const assertCanReceiveGoods = (req: Request) => {
  if (req.user && !isPlatformAdmin(req)) {
    throw new AppError('Only an admin can receive goods', 403, 'FORBIDDEN');
  }
};

export const createPurchaseReceipt = async (req: Request, res: Response) => {
  assertCanReceiveGoods(req);
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
  const data = await purchaseReceiptService.list(parsed.data);
  return res.status(200).json({ success: true, data });
};

export const getPurchaseReceipt = async (req: Request, res: Response) => {
  const receipt = await purchaseReceiptService.get(req.params.id);
  return res.status(200).json({ success: true, data: receipt });
};

export const confirmPurchaseReceipt = async (req: Request, res: Response) => {
  assertCanReceiveGoods(req);
  const receipt = await purchaseReceiptService.confirm(req.params.id);
  return res.status(200).json({ success: true, data: receipt });
};