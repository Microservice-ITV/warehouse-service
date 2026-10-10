import type { Request, Response } from 'express';
import { InventoryService } from '@/services/inventory.service';
import { ValidationError } from '@/utils/errors';
import { listMovementsQuerySchema, listTransfersQuerySchema } from '@/validators/inventory.validators';

const inventoryService = new InventoryService();

const resolveCreatedBy = (req: Request): string | undefined => {
  if (req.user?.sub) return req.user.sub;
  if (typeof req.body.createdBy === 'string' && req.body.createdBy.length > 0) {
    return req.body.createdBy;
  }
  return undefined;
};

export const getWarehouseInventory = async (req: Request, res: Response) => {
  const data = await inventoryService.listWarehouseInventory(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const increaseStock = async (req: Request, res: Response) => {
  const data = await inventoryService.increaseStock({
    ...req.body,
    createdBy: resolveCreatedBy(req),
  });
  return res.status(200).json({ success: true, data });
};

export const requestTransfer = async (req: Request, res: Response) => {
  const data = await inventoryService.requestTransfer({
    ...req.body,
    requestedBy: resolveCreatedBy(req),
  });
  return res.status(201).json({ success: true, data });
};

export const listTransfers = async (req: Request, res: Response) => {
  const parsed = listTransfersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const data = await inventoryService.listTransfers(parsed.data);
  return res.status(200).json({ success: true, data });
};

export const approveTransfer = async (req: Request, res: Response) => {
  const data = await inventoryService.approveTransfer({
    transferId: req.params.id,
    decidedBy: resolveCreatedBy(req),
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  return res.status(200).json({ success: true, data });
};

export const rejectTransfer = async (req: Request, res: Response) => {
  const data = await inventoryService.rejectTransfer({
    transferId: req.params.id,
    decidedBy: resolveCreatedBy(req),
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  return res.status(200).json({ success: true, data });
};

export const receiveStock = async (req: Request, res: Response) => {
  const data = await inventoryService.receiveStock({
    ...req.body,
    createdBy: resolveCreatedBy(req),
  });
  return res.status(200).json({ success: true, data });
};

export const getStockMovements = async (req: Request, res: Response) => {
  const parsed = listMovementsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const data = await inventoryService.listMovements(parsed.data);
  return res.status(200).json({ success: true, data });
};

export const validateProductStock = async (req: Request, res: Response) => {
  const data = await inventoryService.validateProductStock(req.body);
  return res.status(200).json({ success: true, data });
};
