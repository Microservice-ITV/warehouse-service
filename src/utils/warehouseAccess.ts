import type { Request } from 'express';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { AppError, NotFoundError } from '@/utils/errors';

const warehouseRepository = new WarehouseRepository();

const requestRole = (req: Request): string => {
  const role = req.user && 'role' in req.user ? req.user.role : undefined;
  if (typeof role !== 'string') return '';
  return role.trim().toLowerCase().replace(/[\s-]+/g, '_');
};

const PLATFORM_ADMIN_ROLES = new Set([
  'super_admin',
  'platform_super_admin',
  'platform_finance',
  'platform_director',
  'platform_cfo',
]);

export const isPlatformAdmin = (req: Request): boolean => PLATFORM_ADMIN_ROLES.has(requestRole(req));

export const requestUserId = (req: Request): string | undefined => {
  const user = req.user;
  if (!user) return undefined;
  if ('userId' in user && typeof user.userId === 'string' && user.userId.trim()) {
    return user.userId.trim();
  }
  if (typeof user.sub === 'string' && user.sub.trim()) return user.sub.trim();
  return undefined;
};

export const isWarehouseManager = (req: Request): boolean => requestRole(req) === 'warehouse_manager';

/** Undefined means no owner filter. An empty list means the manager has no warehouses. */
export const ownedWarehouseIds = async (req: Request): Promise<string[] | undefined> => {
  if (!req.user || !isWarehouseManager(req)) return undefined;
  const userId = requestUserId(req);
  if (!userId) return [];
  return warehouseRepository.listIdsByCreatedBy(userId);
};

export const assertOwnedWarehouse = (warehouseId: string, ownedIds?: string[]) => {
  if (!ownedIds) return;
  if (!ownedIds.includes(warehouseId)) {
    throw new NotFoundError('Record not found');
  }
};

export const assertWarehouseManager = (req: Request, message: string) => {
  if (req.user && !isWarehouseManager(req)) {
    throw new AppError(message, 403, 'FORBIDDEN');
  }
};

/** A specific warehouse id is kept only when it is inside the manager's set. */
export const warehouseWhere = (warehouseId?: string, warehouseIds?: string[]) => {
  if (warehouseIds) {
    const ids = warehouseId ? warehouseIds.filter((id) => id === warehouseId) : warehouseIds;
    return { warehouseId: { in: ids } };
  }
  if (warehouseId) return { warehouseId };
  return {};
};
