import type { Request, Response } from 'express';
import { WarehouseService } from '@/services/warehouse.service';
import { AppError, ValidationError } from '@/utils/errors';
import { listWarehousesQuerySchema } from '@/validators/warehouse.validators';

const warehouseService = new WarehouseService();

const PLATFORM_ADMIN_ROLES = new Set([
  'super_admin',
  'platform_super_admin',
  'platform_finance',
  'platform_director',
  'platform_cfo',
]);

const requestUserId = (req: Request): string | undefined => {
  const user = req.user;
  if (!user) return undefined;
  if ('userId' in user && typeof user.userId === 'string' && user.userId.trim()) {
    return user.userId.trim();
  }
  if (typeof user.sub === 'string' && user.sub.trim()) return user.sub.trim();
  return undefined;
};

const isPlatformAdmin = (req: Request): boolean => {
  const role = req.user && 'role' in req.user ? req.user.role : undefined;
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PLATFORM_ADMIN_ROLES.has(normalized);
};

/** Service calls and platform admins see every warehouse. Sellers see their own. */
const seesAllWarehouses = (req: Request): boolean => !req.user || isPlatformAdmin(req);

const sellerOwnerId = (req: Request): string | undefined =>
  seesAllWarehouses(req) ? undefined : requestUserId(req);

export const createWarehouse = async (req: Request, res: Response) => {
  const ownerId = sellerOwnerId(req);
  if (!seesAllWarehouses(req) && !ownerId) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const warehouse = await warehouseService.createWarehouse({
    ...req.body,
    createdBy: ownerId ?? null,
  });
  return res.status(201).json({ success: true, data: warehouse });
};

export const updateWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.updateWarehouse(
    req.params.id,
    req.body,
    sellerOwnerId(req)
  );
  return res.status(200).json({ success: true, data: warehouse });
};

export const deleteWarehouse = async (req: Request, res: Response) => {
  await warehouseService.deleteWarehouse(req.params.id, sellerOwnerId(req));
  return res.status(200).json({ success: true });
};

export const getWarehouse = async (req: Request, res: Response) => {
  const warehouse = await warehouseService.getWarehouse(req.params.id, sellerOwnerId(req));
  return res.status(200).json({ success: true, data: warehouse });
};

export const listWarehouses = async (req: Request, res: Response) => {
  const parsed = listWarehousesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const ownerId = sellerOwnerId(req);
  if (!seesAllWarehouses(req) && !ownerId) {
    return res.status(200).json({ success: true, data: [] });
  }

  const data = await warehouseService.listWarehouses({
    status: parsed.data.status,
    createdBy: ownerId,
  });
  return res.status(200).json({ success: true, data });
};
