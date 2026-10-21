import type { Request, Response } from 'express';
import { PurchaseReceiptService } from '@/services/purchaseReceipt.service';
import { PurchaseOrderService } from '@/services/purchaseOrder.service';
import { AppError, ValidationError } from '@/utils/errors';
import {
  assertOwnedWarehouse,
  isDeliveryAgent,
  isPlatformAdmin,
  isWarehouseManager,
  ownedWarehouseIds,
  requestUserId,
} from '@/utils/warehouseAccess';
import { listPurchaseReceiptsQuerySchema } from '@/validators/purchase.validators';

const purchaseReceiptService = new PurchaseReceiptService();
const purchaseOrderService = new PurchaseOrderService();

const sellerIdsFromRequest = (req: Request): string[] =>
  [
    ...new Set(
      [requestUserId(req), typeof req.user?.sub === 'string' ? req.user.sub.trim() : ''].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];

const assertSellerOwnsOrder = (req: Request, createdBy: string | null) => {
  if (!req.user || isWarehouseManager(req) || isPlatformAdmin(req) || isDeliveryAgent(req)) {
    throw new AppError('Only the seller can manage these goods receipts', 403, 'FORBIDDEN');
  }
  const sellerIds = sellerIdsFromRequest(req);
  if (!createdBy || !sellerIds.includes(createdBy)) {
    throw new AppError('You can only manage goods receipts for your own purchase orders', 403, 'FORBIDDEN');
  }
};

const assertSupplierParcelReadyForReceipt = (order: {
  orderKind: string;
  status: string;
}) => {
  if (order.orderKind !== 'SUPPLIER') return;
  if (
    order.status !== 'AWAITING_WAREHOUSE_RECEIPT' &&
    order.status !== 'AWAITING_SELLER_RECEIPT' &&
    order.status !== 'PARTIALLY_RECEIVED'
  ) {
    throw new ValidationError('This parcel is not waiting for a warehouse goods receipt');
  }
};

export const createPurchaseReceipt = async (req: Request, res: Response) => {
  const order = await purchaseOrderService.get(req.body.purchaseOrderId);

  if (isWarehouseManager(req)) {
    const ownedIds = await ownedWarehouseIds(req);
    assertOwnedWarehouse(order.warehouseId, ownedIds);
    assertOwnedWarehouse(req.body.warehouseId ?? order.warehouseId, ownedIds);
    assertSupplierParcelReadyForReceipt(order);
  } else if (isPlatformAdmin(req)) {
    // Platform admins may post receipts for support cases.
  } else if (isDeliveryAgent(req)) {
    throw new AppError(
      'Delivery agents cannot post goods receipts for supplier parcels',
      403,
      'FORBIDDEN',
    );
  } else {
    assertSellerOwnsOrder(req, order.createdBy);
    assertSupplierParcelReadyForReceipt(order);
  }

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

  if (isWarehouseManager(req)) {
    const data = await purchaseReceiptService.list({
      ...parsed.data,
      warehouseIds: await ownedWarehouseIds(req),
    });
    return res.status(200).json({ success: true, data });
  }

  if (isPlatformAdmin(req)) {
    const data = await purchaseReceiptService.list(parsed.data);
    return res.status(200).json({ success: true, data });
  }

  if (isDeliveryAgent(req)) {
    throw new AppError('Delivery agents cannot view goods receipts', 403, 'FORBIDDEN');
  }

  const data = await purchaseReceiptService.list({
    ...parsed.data,
    sellerUserIds: sellerIdsFromRequest(req),
  });
  return res.status(200).json({ success: true, data });
};

export const getPurchaseReceipt = async (req: Request, res: Response) => {
  const receipt = await purchaseReceiptService.get(req.params.id);

  if (isWarehouseManager(req)) {
    assertOwnedWarehouse(receipt.warehouseId, await ownedWarehouseIds(req));
  } else if (!isPlatformAdmin(req)) {
    if (isDeliveryAgent(req)) {
      throw new AppError('Delivery agents cannot view goods receipts', 403, 'FORBIDDEN');
    }
    assertSellerOwnsOrder(req, receipt.purchaseOrder.createdBy);
  }

  return res.status(200).json({ success: true, data: receipt });
};

export const confirmPurchaseReceipt = async (req: Request, res: Response) => {
  const receipt = await purchaseReceiptService.get(req.params.id);

  if (isWarehouseManager(req)) {
    assertOwnedWarehouse(receipt.warehouseId, await ownedWarehouseIds(req));
  } else if (isPlatformAdmin(req)) {
    // Platform admins may confirm receipts for support cases.
  } else if (isDeliveryAgent(req)) {
    throw new AppError(
      'Delivery agents cannot confirm goods receipts for supplier parcels',
      403,
      'FORBIDDEN',
    );
  } else {
    assertSellerOwnsOrder(req, receipt.purchaseOrder.createdBy);
  }

  const confirmed = await purchaseReceiptService.confirm(req.params.id);
  return res.status(200).json({ success: true, data: confirmed });
};
