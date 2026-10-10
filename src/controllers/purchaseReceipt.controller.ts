import type { Request, Response } from 'express';
import { PurchaseReceiptService } from '@/services/purchaseReceipt.service';
import { ValidationError } from '@/utils/errors';
import { listPurchaseReceiptsQuerySchema } from '@/validators/purchase.validators';

const purchaseReceiptService = new PurchaseReceiptService();

export const createPurchaseReceipt = async (req: Request, res: Response) => {
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
  const receipt = await purchaseReceiptService.confirm(req.params.id);
  return res.status(200).json({ success: true, data: receipt });
};