import { Router, type NextFunction, type Request, type Response } from 'express';
import { createWarehouse, updateWarehouse } from '@/controllers/warehouse.controller';
import {
  adjustStock,
  getStockMovements,
  getWarehouseInventory,
  increaseStock,
  validateProductStock,
} from '@/controllers/inventory.controller';
import { authOrService } from '@/middleware/authOrService';
import { serviceAuth } from '@/middleware/serviceAuth';
import { validate } from '@/middleware/validator';
import {
  adjustStockSchema,
  increaseStockSchema,
  validateProductStockSchema,
} from '@/validators/inventory.validators';
import { createWarehouseSchema, updateWarehouseSchema } from '@/validators/warehouse.validators';

const router = Router();

const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
  ) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

router.post('/warehouses', authOrService, validate(createWarehouseSchema), asyncHandler(createWarehouse));
router.patch('/warehouses/:id', authOrService, validate(updateWarehouseSchema), asyncHandler(updateWarehouse));
router.get('/warehouses/:id/inventory', authOrService, asyncHandler(getWarehouseInventory));
router.post('/inventory/increase', authOrService, validate(increaseStockSchema), asyncHandler(increaseStock));
router.post('/inventory/adjust', authOrService, validate(adjustStockSchema), asyncHandler(adjustStock));
router.get('/inventory/movements', authOrService, asyncHandler(getStockMovements));
router.post(
  '/products/validate-stock',
  serviceAuth,
  validate(validateProductStockSchema),
  asyncHandler(validateProductStock)
);

export default router;
