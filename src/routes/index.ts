import { Router, type NextFunction, type Request, type Response } from 'express';
import { createWarehouse } from '@/controllers/warehouse.controller';
import {
  adjustStock,
  getStockMovements,
  getWarehouseInventory,
  increaseStock,
  validateProductStock,
} from '@/controllers/inventory.controller';
import { serviceAuth } from '@/middleware/serviceAuth';
import { validate } from '@/middleware/validator';
import {
  adjustStockSchema,
  increaseStockSchema,
  validateProductStockSchema,
} from '@/validators/inventory.validators';
import { createWarehouseSchema } from '@/validators/warehouse.validators';

const router = Router();

const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
  ) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

router.post('/warehouses', validate(createWarehouseSchema), asyncHandler(createWarehouse));
router.get('/warehouses/:id/inventory', asyncHandler(getWarehouseInventory));
router.post('/inventory/increase', validate(increaseStockSchema), asyncHandler(increaseStock));
router.post('/inventory/adjust', validate(adjustStockSchema), asyncHandler(adjustStock));
router.get('/inventory/movements', asyncHandler(getStockMovements));
router.post(
  '/products/validate-stock',
  serviceAuth,
  validate(validateProductStockSchema),
  asyncHandler(validateProductStock)
);

export default router;
