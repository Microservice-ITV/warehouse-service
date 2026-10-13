import type { Request } from 'express';
import type { Response } from 'express';
import { InventoryService, type StockViewer } from '@/services/inventory.service';
import { AppError, ValidationError } from '@/utils/errors';
import {
  isPlatformAdmin,
  isWarehouseManager,
  requestUserId,
} from '@/utils/warehouseAccess';
import { listMovementsQuerySchema, listTransfersQuerySchema } from '@/validators/inventory.validators';

const inventoryService = new InventoryService();

const stockViewer = (req: Request): StockViewer => {
  if (!req.user || isPlatformAdmin(req)) return { kind: 'all' };
  const userId = requestUserId(req) ?? '';
  if (isWarehouseManager(req)) return { kind: 'owner', userId };
  const userIds = [
    ...new Set(
      [userId, typeof req.user.sub === 'string' ? req.user.sub.trim() : ''].filter(Boolean),
    ),
  ];
  return { kind: 'seller', userId: userIds[0] ?? '', userIds };
};

const resolveCreatedBy = (req: Request): string | undefined => {
  if (req.user?.sub) return req.user.sub;
  if (typeof req.body.createdBy === 'string' && req.body.createdBy.length > 0) {
    return req.body.createdBy;
  }
  return undefined;
};

export const getWarehouseInventory = async (req: Request, res: Response) => {
  const data = await inventoryService.listWarehouseInventory(req.params.id, stockViewer(req));
  return res.status(200).json({ success: true, data });
};

export const increaseStock = async (req: Request, res: Response) => {
  const data = await inventoryService.increaseStock({
    ...req.body,
    createdBy: resolveCreatedBy(req),
  });
  return res.status(200).json({ success: true, data });
};

const sellerActorId = (req: Request): string => {
  const sub = typeof req.user?.sub === 'string' ? req.user.sub.trim() : '';
  return sub || requestUserId(req) || '';
};

export const listSellerStock = async (req: Request, res: Response) => {
  if (!req.user || isPlatformAdmin(req) || isWarehouseManager(req)) {
    throw new AppError('Only a seller can view seller inventory', 403, 'FORBIDDEN');
  }
  const userId = sellerActorId(req);
  if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const data = await inventoryService.listSellerStock(userId);
  return res.status(200).json({ success: true, data });
};

export const requestTransfer = async (req: Request, res: Response) => {
  if (req.user && isPlatformAdmin(req)) {
    throw new AppError('An admin cannot transfer stock', 403, 'FORBIDDEN');
  }
  if (req.body.fromSeller) {
    if (!req.user || isWarehouseManager(req)) {
      throw new AppError('Only a seller can transfer from seller inventory', 403, 'FORBIDDEN');
    }
    const userId = sellerActorId(req);
    if (!userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    const data = await inventoryService.requestSellerTransfer({
      fromSellerUserId: userId,
      toWarehouseId: req.body.toWarehouseId,
      productId: req.body.productId,
      variantId: req.body.variantId,
      quantity: req.body.quantity,
      referenceId: req.body.referenceId,
      requestedBy: userId,
    });
    return res.status(201).json({ success: true, data });
  }
  const viewer = stockViewer(req);
  await inventoryService.assertCanRequestTransfer(
    { fromWarehouseId: req.body.fromWarehouseId, productId: req.body.productId },
    viewer,
  );
  const data = await inventoryService.requestTransfer({
    ...req.body,
    requestedBy: resolveCreatedBy(req),
    requesterIds:
      viewer.kind === 'seller'
        ? (viewer.userIds ?? [viewer.userId])
        : viewer.kind === 'owner'
          ? [viewer.userId]
          : [],
  });
  return res.status(201).json({ success: true, data });
};

export const listTransfers = async (req: Request, res: Response) => {
  const parsed = listTransfersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const data = await inventoryService.listTransfers(parsed.data, stockViewer(req));
  return res.status(200).json({ success: true, data });
};

export const approveTransfer = async (req: Request, res: Response) => {
  if (req.user && isPlatformAdmin(req)) {
    throw new AppError('An admin cannot approve a transfer', 403, 'FORBIDDEN');
  }
  await inventoryService.assertCanDecideTransfer(req.params.id, stockViewer(req));
  const data = await inventoryService.approveTransfer({
    transferId: req.params.id,
    decidedBy: resolveCreatedBy(req),
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  return res.status(200).json({ success: true, data });
};

export const receiveTransfer = async (req: Request, res: Response) => {
  if (req.user && isPlatformAdmin(req)) {
    throw new AppError('An admin cannot receive a transfer', 403, 'FORBIDDEN');
  }
  await inventoryService.assertCanReceiveTransfer(req.params.id, stockViewer(req));
  const data = await inventoryService.receiveTransfer({
    transferId: req.params.id,
    decidedBy: resolveCreatedBy(req),
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  return res.status(200).json({ success: true, data });
};

export const rejectTransfer = async (req: Request, res: Response) => {
  if (req.user && isPlatformAdmin(req)) {
    throw new AppError('An admin cannot reject a transfer', 403, 'FORBIDDEN');
  }
  await inventoryService.assertCanDecideTransfer(req.params.id, stockViewer(req));
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

  const data = await inventoryService.listMovements(parsed.data, stockViewer(req));
  return res.status(200).json({ success: true, data });
};

export const validateProductStock = async (req: Request, res: Response) => {
  const data = await inventoryService.validateProductStock(req.body);
  return res.status(200).json({ success: true, data });
};
