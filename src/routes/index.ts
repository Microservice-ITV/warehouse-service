import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  createWarehouse,
  deleteWarehouse,
  getWarehouse,
  getWarehouseManagers,
  listWarehouses,
  updateWarehouse,
} from '@/controllers/warehouse.controller';
import {
  approveTransfer,
  getStockMovements,
  getWarehouseInventory,
  increaseStock,
  listTransfers,
  receiveStock,
  receiveTransfer,
  rejectTransfer,
  requestTransfer,
  listSellerStock,
  updateStockUnitPrice,
  validateProductStock,
} from '@/controllers/inventory.controller';
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from '@/controllers/supplier.controller';
import {
  applyCostAdjustment,
  createAdditionalCost,
  createCostAdjustment,
  confirmDamageReport,
  createDamageReport,
  createDeliveryStage,
  createPurchaseOrder,
  deliveryAgentPickupOrder,
  deliveryAgentProcessOrder,
  getDamageReport,
  getPurchaseOrder,
  downloadPurchaseOrderAttachment,
  listAdditionalCosts,
  listCostAdjustments,
  listDamageReports,
  listDeliveryStages,
  listPurchaseOrders,
  receiveSupplierOrder,
  sellerReceiveDeliveryOrder,
  markPurchaseOrderRouteArrived,
  updatePurchaseOrderStatus,
} from '@/controllers/purchaseOrder.controller';
import {
  confirmPurchaseReceipt,
  createPurchaseReceipt,
  getPurchaseReceipt,
  listPurchaseReceipts,
} from '@/controllers/purchaseReceipt.controller';
import {
  createPurchaseReturn,
  getPurchaseReturn,
  listPurchaseReturns,
  postPurchaseReturn,
} from '@/controllers/purchaseReturn.controller';
import { authOrService } from '@/middleware/authOrService';
import { serviceAuth } from '@/middleware/serviceAuth';
import { validate } from '@/middleware/validator';
import {
  increaseStockSchema,
  receiveStockSchema,
  transferDecisionSchema,
  transferStockSchema,
  updateUnitPriceSchema,
  validateProductStockSchema,
} from '@/validators/inventory.validators';
import {
  createAdditionalCostSchema,
  createCostAdjustmentSchema,
  createDeliveryStageSchema,
  createDamageReportSchema,
  createPurchaseOrderSchema,
  createPurchaseReceiptSchema,
  createPurchaseReturnSchema,
  createSupplierSchema,
  updatePurchaseOrderStatusSchema,
  updateSupplierSchema,
} from '@/validators/purchase.validators';
import { createWarehouseSchema, updateWarehouseSchema } from '@/validators/warehouse.validators';

const router = Router();

const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
  ) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

router.post('/warehouses', authOrService, validate(createWarehouseSchema), asyncHandler(createWarehouse));
router.get('/warehouse-managers', authOrService, asyncHandler(getWarehouseManagers));
router.get('/warehouses', authOrService, asyncHandler(listWarehouses));
router.get('/warehouses/:id', authOrService, asyncHandler(getWarehouse));
router.patch('/warehouses/:id', authOrService, validate(updateWarehouseSchema), asyncHandler(updateWarehouse));
router.delete('/warehouses/:id', authOrService, asyncHandler(deleteWarehouse));
router.get('/warehouses/:id/inventory', authOrService, asyncHandler(getWarehouseInventory));
router.post('/suppliers', authOrService, validate(createSupplierSchema), asyncHandler(createSupplier));
router.get('/suppliers', authOrService, asyncHandler(listSuppliers));
router.get('/suppliers/:id', authOrService, asyncHandler(getSupplier));
router.patch('/suppliers/:id', authOrService, validate(updateSupplierSchema), asyncHandler(updateSupplier));
router.delete('/suppliers/:id', authOrService, asyncHandler(deleteSupplier));

router.post('/purchase-orders', authOrService, validate(createPurchaseOrderSchema), asyncHandler(createPurchaseOrder));
router.get('/purchase-orders', authOrService, asyncHandler(listPurchaseOrders));
router.get('/purchase-orders/:id', authOrService, asyncHandler(getPurchaseOrder));
router.get(
  '/purchase-orders/:id/attachments/:attachmentId',
  authOrService,
  asyncHandler(downloadPurchaseOrderAttachment),
);
router.patch('/purchase-orders/:id/status', authOrService, validate(updatePurchaseOrderStatusSchema), asyncHandler(updatePurchaseOrderStatus));
router.post('/purchase-orders/:id/receive-supplier', authOrService, asyncHandler(receiveSupplierOrder));
router.post('/purchase-orders/:id/delivery-pickup', authOrService, asyncHandler(deliveryAgentPickupOrder));
router.post('/purchase-orders/:id/delivery-process', authOrService, asyncHandler(deliveryAgentProcessOrder));
router.post('/purchase-orders/:id/seller-receive', authOrService, asyncHandler(sellerReceiveDeliveryOrder));
router.post(
  '/purchase-orders/:id/route-arrived',
  authOrService,
  asyncHandler(markPurchaseOrderRouteArrived),
);
router.post(
  '/purchase-orders/:id/damage-reports',
  authOrService,
  validate(createDamageReportSchema),
  asyncHandler(createDamageReport),
);
router.get('/damage-reports', authOrService, asyncHandler(listDamageReports));
router.get('/damage-reports/:id', authOrService, asyncHandler(getDamageReport));
router.post('/damage-reports/:id/confirm', authOrService, asyncHandler(confirmDamageReport));

router.get('/purchase-orders/:id/delivery-stages', authOrService, asyncHandler(listDeliveryStages));
router.post('/purchase-orders/:id/delivery-stages', authOrService, validate(createDeliveryStageSchema), asyncHandler(createDeliveryStage));
router.get('/purchase-orders/:id/additional-costs', authOrService, asyncHandler(listAdditionalCosts));
router.post('/purchase-orders/:id/additional-costs', authOrService, validate(createAdditionalCostSchema), asyncHandler(createAdditionalCost));
router.get('/purchase-orders/:id/cost-adjustments', authOrService, asyncHandler(listCostAdjustments));
router.post('/purchase-orders/:id/cost-adjustments', authOrService, validate(createCostAdjustmentSchema), asyncHandler(createCostAdjustment));
router.post('/purchase-cost-adjustments/:id/apply', authOrService, asyncHandler(applyCostAdjustment));

router.post('/purchase-receipts', authOrService, validate(createPurchaseReceiptSchema), asyncHandler(createPurchaseReceipt));
router.get('/purchase-receipts', authOrService, asyncHandler(listPurchaseReceipts));
router.get('/purchase-receipts/:id', authOrService, asyncHandler(getPurchaseReceipt));
router.post('/purchase-receipts/:id/confirm', authOrService, asyncHandler(confirmPurchaseReceipt));

router.post('/purchase-returns', authOrService, validate(createPurchaseReturnSchema), asyncHandler(createPurchaseReturn));
router.get('/purchase-returns', authOrService, asyncHandler(listPurchaseReturns));
router.get('/purchase-returns/:id', authOrService, asyncHandler(getPurchaseReturn));
router.post('/purchase-returns/:id/post', authOrService, asyncHandler(postPurchaseReturn));

router.post('/inventory/increase', authOrService, validate(increaseStockSchema), asyncHandler(increaseStock));
router.get('/inventory/seller', authOrService, asyncHandler(listSellerStock));
router.patch('/inventory/stocks/:id/unit-price', authOrService, validate(updateUnitPriceSchema), asyncHandler(updateStockUnitPrice));
router.post('/inventory/transfer', authOrService, validate(transferStockSchema), asyncHandler(requestTransfer));
router.get('/inventory/transfers', authOrService, asyncHandler(listTransfers));
router.post('/inventory/transfers/:id/approve', authOrService, validate(transferDecisionSchema), asyncHandler(approveTransfer));
router.post('/inventory/transfers/:id/receive', authOrService, validate(transferDecisionSchema), asyncHandler(receiveTransfer));
router.post('/inventory/transfers/:id/reject', authOrService, validate(transferDecisionSchema), asyncHandler(rejectTransfer));
router.post('/inventory/receive', authOrService, validate(receiveStockSchema), asyncHandler(receiveStock));
router.get('/inventory/movements', authOrService, asyncHandler(getStockMovements));
router.post(
  '/products/validate-stock',
  serviceAuth,
  validate(validateProductStockSchema),
  asyncHandler(validateProductStock)
);

export default router;
