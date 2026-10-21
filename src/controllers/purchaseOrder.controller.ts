import type { Request, Response } from 'express';
import { PurchaseOrderService } from '@/services/purchaseOrder.service';
import { AppError, ValidationError } from '@/utils/errors';
import {
  assertDeliveryAgent,
  assertOwnedWarehouse,
  assertWarehouseManager,
  isDeliveryAgent,
  isPlatformAdmin,
  isWarehouseManager,
  ownedWarehouseIds,
  requestUserId,
} from '@/utils/warehouseAccess';
import {
  createDamageReportSchema,
  deliveryProcessConfirmSchema,
  listPurchaseOrdersQuerySchema,
} from '@/validators/purchase.validators';

const purchaseOrderService = new PurchaseOrderService();

export const createPurchaseOrder = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.create({
    ...req.body,
    createdBy: req.user?.sub,
  });
  return res.status(201).json({ success: true, data: order });
};

export const listPurchaseOrders = async (req: Request, res: Response) => {
  const parsed = listPurchaseOrdersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  if (isDeliveryAgent(req)) {
    // Filter supplier orders in the query so a mixed PO list is not truncated away.
    const data = await purchaseOrderService.list({
      ...parsed.data,
      orderKinds: ['SUPPLIER'],
      limit: parsed.data.limit ?? 500,
    });
    return res.status(200).json({ success: true, data });
  }
  const warehouseIds = await ownedWarehouseIds(req);
  const createdByIds =
    req.user && !isPlatformAdmin(req) && !isWarehouseManager(req)
      ? [
          ...new Set(
            [requestUserId(req), typeof req.user.sub === 'string' ? req.user.sub.trim() : '']
              .filter((id): id is string => Boolean(id)),
          ),
        ]
      : undefined;
  const data = await purchaseOrderService.list({ ...parsed.data, warehouseIds, createdByIds });
  return res.status(200).json({ success: true, data });
};

export const getPurchaseOrder = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.params.id);
  if (!isDeliveryAgent(req)) {
    assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));
  }
  return res.status(200).json({ success: true, data: order });
};

export const downloadPurchaseOrderAttachment = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.params.id);
  if (!isDeliveryAgent(req)) {
    assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));
  }
  const file = await purchaseOrderService.getAttachment(req.params.id, req.params.attachmentId);
  const fileName = file.fileName.replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(file.sizeBytes));
  return res.status(200).send(file.content);
};

export const receiveSupplierOrder = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.receiveSupplierStock(req.params.id, req.user?.sub);
  return res.status(200).json({ success: true, data });
};

const sellerIdsFromRequest = (req: Request): string[] =>
  [
    ...new Set(
      [requestUserId(req), typeof req.user?.sub === 'string' ? req.user.sub.trim() : ''].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];

const assertSellerOrDeliveryAgentCanProcess = async (req: Request, orderId: string) => {
  if (isDeliveryAgent(req)) return;
  if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req)) {
    throw new AppError(
      'Only a delivery agent or the seller can confirm and pick up a supplier parcel',
      403,
      'FORBIDDEN',
    );
  }
  const order = await purchaseOrderService.get(orderId);
  const sellerIds = sellerIdsFromRequest(req);
  if (!order.createdBy || !sellerIds.includes(order.createdBy)) {
    throw new AppError(
      'You can only confirm and pick up your own supplier parcels',
      403,
      'FORBIDDEN',
    );
  }
};

export const deliveryAgentPickupOrder = async (req: Request, res: Response) => {
  await assertSellerOrDeliveryAgentCanProcess(req, req.params.id);
  const data = await purchaseOrderService.deliveryAgentPickup(req.params.id, req.user?.sub);
  return res.status(200).json({ success: true, data });
};

export const deliveryAgentProcessOrder = async (req: Request, res: Response) => {
  await assertSellerOrDeliveryAgentCanProcess(req, req.params.id);
  const parsed = deliveryProcessConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const confirmedBy = requestUserId(req) ?? req.user?.sub;
  if (!confirmedBy) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const data = await purchaseOrderService.deliveryAgentMarkProcessed(req.params.id, {
    confirmedBy,
    notes: parsed.data.notes,
    items: parsed.data.items,
  });
  return res.status(200).json({ success: true, data });
};

export const sellerReceiveDeliveryOrder = async (req: Request, res: Response) => {
  if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req) || isDeliveryAgent(req)) {
    throw new AppError('Only the seller can receive stock from a warehouse order', 403, 'FORBIDDEN');
  }
  const sellerUserId =
    (typeof req.user.sub === 'string' && req.user.sub.trim()) || requestUserId(req) || '';
  if (!sellerUserId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const data = await purchaseOrderService.sellerReceiveFromDelivery(
    req.params.id,
    sellerUserId,
    req.user.sub,
  );
  return res.status(200).json({ success: true, data });
};

export const markPurchaseOrderRouteArrived = async (req: Request, res: Response) => {
  if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req) || isDeliveryAgent(req)) {
    throw new AppError('Only the seller can confirm route arrival', 403, 'FORBIDDEN');
  }
  const sellerUserId =
    (typeof req.user.sub === 'string' && req.user.sub.trim()) || requestUserId(req) || '';
  if (!sellerUserId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const data = await purchaseOrderService.markRouteArrived(
    req.params.id,
    sellerUserId,
    req.user.sub,
  );
  return res.status(200).json({ success: true, data });
};

export const createDamageReport = async (req: Request, res: Response) => {
  assertDeliveryAgent(req, 'Only a delivery agent can submit a damage report');
  const parsed = createDamageReportSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const reportedBy = requestUserId(req) ?? req.user?.sub;
  if (!reportedBy) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const data = await purchaseOrderService.createDamageReport({
    purchaseOrderId: req.params.id,
    reportedBy,
    notes: parsed.data.notes,
    items: parsed.data.items,
  });
  return res.status(201).json({ success: true, data });
};

export const listDamageReports = async (req: Request, res: Response) => {
  if (isDeliveryAgent(req)) {
    const reportedBy = requestUserId(req) ?? req.user?.sub;
    const data = await purchaseOrderService.listDamageReports({
      purchaseOrderId: typeof req.query.purchaseOrderId === 'string' ? req.query.purchaseOrderId : undefined,
      reportedBy: reportedBy || undefined,
    });
    return res.status(200).json({ success: true, data });
  }
  if (isPlatformAdmin(req)) {
    const data = await purchaseOrderService.listDamageReports({
      purchaseOrderId: typeof req.query.purchaseOrderId === 'string' ? req.query.purchaseOrderId : undefined,
    });
    return res.status(200).json({ success: true, data });
  }
  if (isWarehouseManager(req)) {
    throw new AppError('Warehouse managers cannot view damage reports', 403, 'FORBIDDEN');
  }
  const sellerUserIds = [
    ...new Set(
      [requestUserId(req), typeof req.user?.sub === 'string' ? req.user.sub.trim() : ''].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  const data = await purchaseOrderService.listDamageReports({
    purchaseOrderId: typeof req.query.purchaseOrderId === 'string' ? req.query.purchaseOrderId : undefined,
    sellerUserIds,
  });
  return res.status(200).json({ success: true, data });
};

export const getDamageReport = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.getDamageReport(req.params.id);
  if (isDeliveryAgent(req)) {
    const userId = requestUserId(req) ?? req.user?.sub;
    if (data.reportedBy !== userId) {
      throw new AppError('You can only view your own damage reports', 403, 'FORBIDDEN');
    }
  } else if (!isPlatformAdmin(req) && !isWarehouseManager(req)) {
    const sellerUserIds = [
      ...new Set(
        [requestUserId(req), typeof req.user?.sub === 'string' ? req.user.sub.trim() : ''].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    if (!data.purchaseOrder.createdBy || !sellerUserIds.includes(data.purchaseOrder.createdBy)) {
      throw new AppError('You can only view damage reports for your orders', 403, 'FORBIDDEN');
    }
  } else if (isWarehouseManager(req)) {
    throw new AppError('Warehouse managers cannot view damage reports', 403, 'FORBIDDEN');
  }
  return res.status(200).json({ success: true, data });
};

export const confirmDamageReport = async (req: Request, res: Response) => {
  if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req) || isDeliveryAgent(req)) {
    throw new AppError('Only the seller can confirm a damage report', 403, 'FORBIDDEN');
  }
  const sellerUserId =
    (typeof req.user.sub === 'string' && req.user.sub.trim()) || requestUserId(req) || '';
  if (!sellerUserId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const data = await purchaseOrderService.confirmDamageReport(req.params.id, sellerUserId);
  return res.status(200).json({ success: true, data });
};

export const updatePurchaseOrderStatus = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.params.id);
  assertOwnedWarehouse(order.warehouseId, await ownedWarehouseIds(req));

  if (req.body.status === 'CANCELLED' && isWarehouseManager(req)) {
    // WM may reject a pending seller warehouse request; supplier POs stay seller-owned.
    const canRejectWarehouseRequest =
      order.orderKind === 'WAREHOUSE' &&
      ['PENDING_APPROVAL', 'PENDING', 'LOW_STOCK'].includes(order.status);
    if (!canRejectWarehouseRequest) {
      throw new AppError(
        'Warehouse managers cannot cancel purchase orders',
        403,
        'FORBIDDEN',
      );
    }
  }
  if (
    req.body.status === 'CANCELLED' &&
    req.user &&
    !isWarehouseManager(req) &&
    !isPlatformAdmin(req) &&
    !isDeliveryAgent(req)
  ) {
    // Seller may cancel their own open warehouse requests (including low stock).
    const sellerUserId =
      (typeof req.user.sub === 'string' && req.user.sub.trim()) || requestUserId(req) || '';
    const ownsOrder = Boolean(order.createdBy && order.createdBy === sellerUserId);
    const canCancelWarehouseRequest =
      order.orderKind === 'WAREHOUSE' &&
      ownsOrder &&
      ['PENDING_APPROVAL', 'PENDING', 'LOW_STOCK', 'RESTOCK_REQUESTED', 'RESTOCK_APPROVED'].includes(
        order.status,
      );
    if (!canCancelWarehouseRequest) {
      throw new AppError('You can only cancel your own open warehouse requests', 403, 'FORBIDDEN');
    }
  }
  if (req.body.status === 'APPROVED') {
    assertWarehouseManager(req, 'Only a warehouse manager can approve a purchase order');
  }
  if (req.body.status === 'RESTOCK_REQUESTED') {
    assertWarehouseManager(req, 'Only a warehouse manager can request a restock');
  }
  if (req.body.status === 'RESTOCK_APPROVED') {
    if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req)) {
      throw new AppError('Only the seller can approve a restock request', 403, 'FORBIDDEN');
    }
  }
  const updated = await purchaseOrderService.setStatus(req.params.id, {
    ...req.body,
    changedBy: req.user?.sub,
  });
  return res.status(200).json({ success: true, data: updated });
};

// --- Delivery stages ---------------------------------------------------------

export const listDeliveryStages = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.listDeliveryStages(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const createDeliveryStage = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.createDeliveryStage(req.params.id, req.body);
  return res.status(201).json({ success: true, data });
};

// --- Additional costs --------------------------------------------------------

export const listAdditionalCosts = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.listAdditionalCosts(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const createAdditionalCost = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.createAdditionalCost(req.params.id, req.body);
  return res.status(201).json({ success: true, data });
};

// --- Cost adjustments --------------------------------------------------------

export const listCostAdjustments = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.listCostAdjustments(req.params.id);
  return res.status(200).json({ success: true, data });
};

export const createCostAdjustment = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.createCostAdjustment(req.params.id, {
    ...req.body,
    createdBy: req.user?.sub,
  });
  return res.status(201).json({ success: true, data });
};

export const applyCostAdjustment = async (req: Request, res: Response) => {
  const data = await purchaseOrderService.applyCostAdjustment(req.params.id);
  return res.status(200).json({ success: true, data });
};
