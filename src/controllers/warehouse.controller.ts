import type { Request, Response } from 'express';
import { InventoryService } from '@/services/inventory.service';
import { WarehouseService } from '@/services/warehouse.service';
import { AppError, ValidationError } from '@/utils/errors';
import { listWarehousesQuerySchema } from '@/validators/warehouse.validators';

const warehouseService = new WarehouseService();
const inventoryService = new InventoryService();

const PLATFORM_ADMIN_ROLES = new Set([
  'super_admin',
  'platform_super_admin',
  'platform_finance',
  'platform_director',
  'platform_cfo',
]);

const requestRole = (req: Request): string => {
  const role = req.user && 'role' in req.user ? req.user.role : undefined;
  if (typeof role !== 'string') return '';
  return role.trim().toLowerCase().replace(/[\s-]+/g, '_');
};

const requestUserId = (req: Request): string | undefined => {
  const user = req.user;
  if (!user) return undefined;
  if ('userId' in user && typeof user.userId === 'string' && user.userId.trim()) {
    return user.userId.trim();
  }
  if (typeof user.sub === 'string' && user.sub.trim()) return user.sub.trim();
  return undefined;
};

const isPlatformAdmin = (req: Request): boolean => PLATFORM_ADMIN_ROLES.has(requestRole(req));

const isWarehouseManager = (req: Request): boolean => requestRole(req) === 'warehouse_manager';

/** Service calls and platform admins see every warehouse. Sellers and warehouse managers see their own. */
const seesAllWarehouses = (req: Request): boolean => !req.user || isPlatformAdmin(req);

const sellerOwnerId = (req: Request): string | undefined =>
  seesAllWarehouses(req) ? undefined : requestUserId(req);

export const createWarehouse = async (req: Request, res: Response) => {
  if (req.user && isPlatformAdmin(req)) {
    throw new AppError('An admin cannot create a warehouse', 403, 'FORBIDDEN');
  }
  if (req.user && isWarehouseManager(req)) {
    throw new AppError('A warehouse manager cannot create a warehouse', 403, 'FORBIDDEN');
  }

  const managerUserId =
    typeof req.body?.managerUserId === 'string' ? req.body.managerUserId : undefined;
  if (req.user && !managerUserId) {
    throw new ValidationError('Select a warehouse manager');
  }

  const sellerUserId =
    typeof req.user?.sub === 'string' && req.user.sub.trim()
      ? req.user.sub.trim()
      : requestUserId(req);

  const warehouse = await warehouseService.createWarehouse({
    name: req.body.name,
    code: req.body.code,
    address: req.body.address,
    status: req.body.status,
    createdBy: managerUserId ?? null,
    sellerUserId: sellerUserId ?? null,
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
  const ownerId = isWarehouseManager(req) ? sellerOwnerId(req) : undefined;
  const warehouse = await warehouseService.getWarehouse(req.params.id, ownerId);
  return res.status(200).json({ success: true, data: warehouse });
};

export const listWarehouses = async (req: Request, res: Response) => {
  const parsed = listWarehousesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }

  const catalog = parsed.data.catalog === 'true' || parsed.data.catalog === '1';
  const includePurchased =
    parsed.data.includePurchased === 'true' || parsed.data.includePurchased === '1';
  const ownerId = catalog ? undefined : sellerOwnerId(req);
  if (!catalog && !seesAllWarehouses(req) && !ownerId) {
    return res.status(200).json({ success: true, data: [] });
  }

  const data = await warehouseService.listWarehouses({
    status: parsed.data.status,
    createdBy: ownerId,
  });

  if (!includePurchased || !ownerId || seesAllWarehouses(req) || isWarehouseManager(req)) {
    return res.status(200).json({ success: true, data });
  }

  const purchaseUserIds = [
    ...new Set(
      [ownerId, typeof req.user?.sub === 'string' ? req.user.sub.trim() : ''].filter(Boolean),
    ),
  ];
  const extraIds = (await inventoryService.purchasedWarehouseIds(purchaseUserIds)).filter(
    (id) => !data.some((warehouse) => warehouse.id === id),
  );
  const extras = [];
  for (const id of extraIds) {
    try {
      const warehouse = await warehouseService.getWarehouse(id);
      if (!parsed.data.status || warehouse.status === parsed.data.status) extras.push(warehouse);
    } catch {
      // A receipt can point at a warehouse that was removed.
    }
  }
  return res.status(200).json({ success: true, data: [...data, ...extras] });
};
