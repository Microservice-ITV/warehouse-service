import type {
  AdditionalCostCategory,
  CostAllocationMethod,
  CostStatus,
  Prisma,
  PurchaseCostAdjustmentType,
  PurchaseOrderStatus,
} from '@prisma/client';
import prisma from '@/config/database';
import { InventoryService } from '@/services/inventory.service';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { warehouseWhere } from '@/utils/warehouseAccess';

export const round2 = (value: number) => Number(value.toFixed(2));

export const generateDocumentNumber = (prefix: string) => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
};

export type PurchaseOrderItemInput = {
  productId: string;
  variantId?: string;
  sku?: string | null;
  productName?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity: number;
  unitCost: number;
  discountAmount?: number;
  weightPerUnit?: number;
  volumePerUnit?: number;
};

export type PurchaseDeliveryStageInput = {
  sequence?: number;
  name: string;
  carrier?: string | null;
  feeAmount: number;
  currency?: string;
  allocationMethod?: CostAllocationMethod;
  applicableProductIds?: string[];
  notes?: string | null;
};

export type PurchaseAdditionalCostInput = {
  name: string;
  category?: AdditionalCostCategory;
  amount: number;
  currency?: string;
  allocationMethod?: CostAllocationMethod;
  status?: CostStatus;
  applicableProductIds?: string[];
  notes?: string | null;
};

export type PurchaseCostAdjustmentInput = {
  type?: PurchaseCostAdjustmentType;
  amount: number;
  currency?: string;
  allocationMethod?: CostAllocationMethod;
  reason?: string | null;
  createdBy?: string | null;
};

export class PurchaseOrderService {
  private readonly inventoryService = new InventoryService();
  async list(params: {
    status?: PurchaseOrderStatus;
    supplierId?: string;
    warehouseId?: string;
    warehouseIds?: string[];
    createdByIds?: string[];
    limit?: number;
  } = {}) {
    return prisma.purchaseOrder.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...warehouseWhere(params.warehouseId, params.warehouseIds),
        ...(params.createdByIds ? { createdBy: { in: params.createdByIds } } : {}),
      },
      include: { items: true, supplier: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async get(id: string) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: true,
        supplier: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        receipts: { include: { items: true } },
        deliveryStages: { orderBy: { sequence: 'asc' } },
        additionalCosts: { orderBy: { createdAt: 'asc' } },
        costAdjustments: { orderBy: { createdAt: 'asc' } },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: order.warehouseId },
      select: { id: true, name: true, code: true },
    });
    return { ...order, warehouse };
  }

  async getAttachment(orderId: string, attachmentId: string) {
    const file = await prisma.purchaseOrderAttachment.findFirst({
      where: { id: attachmentId, purchaseOrderId: orderId },
    });
    if (!file) throw new NotFoundError('Attachment not found');
    return file;
  }

  async create(input: {
    supplierId?: string;
    warehouseId: string;
    currency?: string;
    exchangeRate?: number;
    paymentTerms?: string | null;
    deliveryTerms?: string | null;
    notes?: string | null;
    supplierContact?: string | null;
    orderDate?: string | null;
    expectedAt?: string | null;
    discountAmount?: number;
    taxAmount?: number;
    shippingAmount?: number;
    createdBy?: string | null;
    orderKind?: 'WAREHOUSE' | 'SUPPLIER';
    asDraft?: boolean;
    items: PurchaseOrderItemInput[];
    deliveryStages?: PurchaseDeliveryStageInput[];
    additionalCosts?: PurchaseAdditionalCostInput[];
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      contentBase64: string;
    }>;
  }) {
    const kind = input.orderKind ?? 'SUPPLIER';
    if (kind === 'SUPPLIER' && !input.supplierId) {
      throw new ValidationError('Select a supplier.');
    }
    const supplier = input.supplierId
      ? await prisma.supplier.findUnique({ where: { id: input.supplierId } })
      : null;
    if (kind === 'SUPPLIER' && !supplier) throw new NotFoundError('Supplier not found');
    if (input.items.length === 0) throw new ValidationError('At least one item is required');

    const items = input.items.map((item) => {
      const gross = item.quantity * item.unitCost;
      const lineDiscount = item.discountAmount ?? 0;
      return {
        productId: item.productId,
        variantId: item.variantId ?? '',
        sku: item.sku ?? null,
        productName: item.productName ?? null,
        description: item.description ?? null,
        unit: item.unit ?? null,
        quantity: item.quantity,
        unitCost: item.unitCost,
        discountAmount: round2(lineDiscount),
        weightPerUnit: item.weightPerUnit ?? 0,
        volumePerUnit: item.volumePerUnit ?? 0,
        lineTotal: round2(gross - lineDiscount),
      };
    });

    const subtotal = round2(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const discountAmount = round2(input.discountAmount ?? 0);
    const taxAmount = round2(input.taxAmount ?? 0);
    const shippingAmount = round2(input.shippingAmount ?? 0);
    const deliveryStages = (input.deliveryStages ?? []).map((stage, index) => ({
      sequence: stage.sequence ?? index + 1,
      name: stage.name,
      carrier: stage.carrier ?? null,
      feeAmount: round2(stage.feeAmount ?? 0),
      currency: stage.currency ?? input.currency ?? 'USD',
      allocationMethod: stage.allocationMethod ?? 'QUANTITY',
      applicableProductIds: stage.applicableProductIds ?? [],
      notes: stage.notes ?? null,
    }));

    const additionalCosts = (input.additionalCosts ?? []).map((cost) => ({
      name: cost.name,
      category: cost.category ?? 'OTHER',
      amount: round2(cost.amount ?? 0),
      currency: cost.currency ?? input.currency ?? 'USD',
      allocationMethod: cost.allocationMethod ?? 'QUANTITY',
      status: cost.status ?? 'ESTIMATED',
      applicableProductIds: cost.applicableProductIds ?? [],
      notes: cost.notes ?? null,
    }));

    const additionalTotal = round2(additionalCosts.reduce((sum, cost) => sum + cost.amount, 0));
    const totalAmount = round2(subtotal - discountAmount + taxAmount + shippingAmount + additionalTotal);
    const attachments = (input.attachments ?? []).map((file) => ({
      fileName: file.fileName,
      mimeType: file.mimeType || 'application/octet-stream',
      sizeBytes: file.sizeBytes,
      content: Buffer.from(file.contentBase64, 'base64'),
    }));

    const shortage =
      kind === 'WAREHOUSE'
        ? await this.shortageNote(
            input.warehouseId,
            items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
            })),
          )
        : null;
    const initialStatus = input.asDraft
      ? 'DRAFT'
      : kind === 'SUPPLIER'
        ? 'ORDERED'
        : shortage
          ? 'LOW_STOCK'
          : 'PENDING_APPROVAL';
    const historyNote = input.asDraft
      ? null
      : kind === 'SUPPLIER'
        ? 'Waiting for the warehouse manager to receive the products.'
        : shortage;

    return prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
        data: {
          orderNumber: generateDocumentNumber('PO'),
          supplierId: input.supplierId ?? null,
          warehouseId: input.warehouseId,
          status: initialStatus,
          currency: input.currency ?? 'USD',
          exchangeRate: input.exchangeRate ?? 1,
          paymentTerms: input.paymentTerms ?? supplier?.paymentTerms ?? null,
          deliveryTerms: input.deliveryTerms ?? null,
          notes: input.notes ?? null,
          supplierContact: input.supplierContact ?? null,
          orderDate: input.orderDate ? new Date(input.orderDate) : null,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
          subtotal,
          discountAmount,
          taxAmount,
          shippingAmount,
          totalAmount,
          createdBy: input.createdBy ?? null,
          orderKind: kind,
          items: { create: items },
          ...(deliveryStages.length > 0 ? { deliveryStages: { create: deliveryStages } } : {}),
          ...(additionalCosts.length > 0 ? { additionalCosts: { create: additionalCosts } } : {}),
          ...(attachments.length > 0 ? { attachments: { create: attachments } } : {}),
          statusHistory: {
            create: {
              status: initialStatus,
              note: historyNote,
              changedBy: input.createdBy ?? null,
            },
          },
        },
        include: {
          items: true,
          statusHistory: true,
          deliveryStages: { orderBy: { sequence: 'asc' } },
          additionalCosts: true,
          attachments: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
      });

      return order;
    });
  }

  async receiveSupplierStock(id: string, changedBy?: string | null) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.orderKind !== 'SUPPLIER') {
      throw new ValidationError('Only a supplier order is received into the warehouse this way');
    }
    if (order.status !== 'ORDERED') {
      throw new ValidationError('This supplier order is not waiting to be received');
    }

    return prisma.$transaction(async (tx) => {
      await this.inventoryService.applyGoodsReceiptInTx(tx, {
        receiptId: order.id,
        warehouseId: order.warehouseId,
        items: order.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitCost: Number(item.unitCost),
        })),
      });
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'RECEIVED' },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: id,
          status: 'RECEIVED',
          note: 'Warehouse manager received the supplier products.',
          changedBy: changedBy ?? null,
        },
      });
      await this.reopenCoveredWarehouseRequests(tx, {
        warehouseId: order.warehouseId,
        createdBy: order.createdBy,
      });
      return updated;
    });
  }

  async setStatus(
    id: string,
    input: { status: PurchaseOrderStatus; note?: string; changedBy?: string }
  ) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { receipts: true, items: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.status === 'CANCELLED') {
      throw new ValidationError('Cancelled purchase orders cannot be updated');
    }
    if (input.status === 'CANCELLED' && order.receipts.length > 0) {
      throw new ValidationError('Cannot cancel a purchase order that has receipts');
    }
    if (
      input.status === 'RESTOCK_REQUESTED' &&
      !['LOW_STOCK', 'PENDING_APPROVAL', 'PENDING'].includes(order.status)
    ) {
      throw new ValidationError('A restock request is only for an order the warehouse cannot fill');
    }
    if (input.status === 'RESTOCK_APPROVED' && order.status !== 'RESTOCK_REQUESTED') {
      throw new ValidationError('Approve the warehouse manager’s restock request first');
    }

    let nextStatus = input.status;
    let note = input.note;
    const checksWarehouse =
      order.orderKind === 'WAREHOUSE' &&
      (input.status === 'PENDING_APPROVAL' ||
        input.status === 'APPROVED' ||
        input.status === 'ORDERED');
    if (checksWarehouse) {
      const shortage = await this.shortageNote(order.warehouseId, order.items);
      if (shortage) {
        nextStatus = 'LOW_STOCK';
        note = shortage;
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(nextStatus === 'ORDERED' ? { orderedAt: new Date() } : {}),
        },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: id,
          status: nextStatus,
          note: note ?? null,
          changedBy: input.changedBy ?? null,
        },
      });
      return updated;
    });
  }

  /**
   * A supplier receipt stocks the warehouse. The seller's earlier warehouse
   * request can then be approved again, instead of placing a new warehouse order.
   */
  private async reopenCoveredWarehouseRequests(
    tx: Prisma.TransactionClient,
    input: { warehouseId: string; createdBy?: string | null },
  ) {
    const waiting = await tx.purchaseOrder.findMany({
      where: {
        warehouseId: input.warehouseId,
        orderKind: 'WAREHOUSE',
        status: { in: ['LOW_STOCK', 'RESTOCK_REQUESTED', 'RESTOCK_APPROVED'] },
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });
    const reserved = new Map<string, number>();
    for (const order of waiting) {
      const needed = new Map<string, number>();
      let covered = true;
      for (const item of order.items) {
        needed.set(item.productId, (needed.get(item.productId) ?? 0) + item.quantity);
      }
      for (const [productId, quantity] of needed) {
        const available = await this.inventoryService.availableQty(input.warehouseId, productId, tx);
        const alreadyReserved = reserved.get(productId) ?? 0;
        if (available - alreadyReserved < quantity) {
          covered = false;
          break;
        }
      }
      if (!covered) continue;
      for (const [productId, quantity] of needed) {
        reserved.set(productId, (reserved.get(productId) ?? 0) + quantity);
      }
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: 'PENDING_APPROVAL' },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: order.id,
          status: 'PENDING_APPROVAL',
          note: 'Stock is in the warehouse. The warehouse manager can approve this request.',
          changedBy: input.createdBy ?? null,
        },
      });
    }
  }

  private async shortageNote(
    warehouseId: string,
    items: Array<{ productId: string; productName: string | null; quantity: number }>,
  ): Promise<string | null> {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    const warehouseName = warehouse?.name ?? 'this warehouse';
    const lines: string[] = [];
    for (const item of items) {
      const available = await this.inventoryService.availableQty(warehouseId, item.productId);
      if (available < item.quantity) {
        const label = item.productName?.trim() || 'A product';
        lines.push(
          `${label}: available ${available}, requested ${item.quantity} in ${warehouseName}.`,
        );
      }
    }
    return lines.length > 0 ? lines.join(' ') : null;
  }

  // --- Delivery stages -------------------------------------------------------

  async listDeliveryStages(purchaseOrderId: string) {
    await this.assertOrderExists(purchaseOrderId);
    return prisma.purchaseDeliveryStage.findMany({
      where: { purchaseOrderId },
      orderBy: { sequence: 'asc' },
    });
  }

  async createDeliveryStage(purchaseOrderId: string, input: PurchaseDeliveryStageInput) {
    await this.assertOrderExists(purchaseOrderId);
    const count = await prisma.purchaseDeliveryStage.count({ where: { purchaseOrderId } });
    return prisma.purchaseDeliveryStage.create({
      data: {
        purchaseOrderId,
        sequence: input.sequence ?? count + 1,
        name: input.name,
        carrier: input.carrier ?? null,
        feeAmount: round2(input.feeAmount ?? 0),
        currency: input.currency ?? 'USD',
        allocationMethod: input.allocationMethod ?? 'QUANTITY',
        applicableProductIds: input.applicableProductIds ?? [],
        notes: input.notes ?? null,
      },
    });
  }

  // --- Additional costs ------------------------------------------------------

  async listAdditionalCosts(purchaseOrderId: string) {
    await this.assertOrderExists(purchaseOrderId);
    return prisma.purchaseAdditionalCost.findMany({
      where: { purchaseOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createAdditionalCost(purchaseOrderId: string, input: PurchaseAdditionalCostInput) {
    await this.assertOrderExists(purchaseOrderId);
    return prisma.purchaseAdditionalCost.create({
      data: {
        purchaseOrderId,
        name: input.name,
        category: input.category ?? 'OTHER',
        amount: round2(input.amount ?? 0),
        currency: input.currency ?? 'USD',
        allocationMethod: input.allocationMethod ?? 'QUANTITY',
        status: input.status ?? 'ESTIMATED',
        applicableProductIds: input.applicableProductIds ?? [],
        notes: input.notes ?? null,
      },
    });
  }

  // --- Cost adjustments ------------------------------------------------------

  async listCostAdjustments(purchaseOrderId: string) {
    await this.assertOrderExists(purchaseOrderId);
    return prisma.purchaseCostAdjustment.findMany({
      where: { purchaseOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCostAdjustment(
    purchaseOrderId: string,
    input: PurchaseCostAdjustmentInput
  ) {
    await this.assertOrderExists(purchaseOrderId);
    return prisma.purchaseCostAdjustment.create({
      data: {
        adjustmentNumber: generateDocumentNumber('ADJ'),
        purchaseOrderId,
        type: input.type ?? 'OTHER',
        amount: round2(input.amount ?? 0),
        currency: input.currency ?? 'USD',
        allocationMethod: input.allocationMethod ?? 'QUANTITY',
        reason: input.reason ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async applyCostAdjustment(id: string) {
    const adjustment = await prisma.purchaseCostAdjustment.findUnique({ where: { id } });
    if (!adjustment) throw new NotFoundError('Cost adjustment not found');
    if (adjustment.isApplied) {
      throw new ValidationError('Cost adjustment has already been applied');
    }

    return prisma.$transaction(async (tx) => {
      const applied = await tx.purchaseCostAdjustment.update({
        where: { id },
        data: { isApplied: true, appliedAt: new Date() },
      });

      const order = await tx.purchaseOrder.findUnique({
        where: { id: adjustment.purchaseOrderId },
      });
      if (order) {
        const amount = round2(Number(adjustment.amount));
        const isFreight = adjustment.type === 'FREIGHT';
        const shippingAmount = isFreight
          ? round2(Number(order.shippingAmount) + amount)
          : Number(order.shippingAmount);
        const taxAmount = isFreight
          ? Number(order.taxAmount)
          : round2(Number(order.taxAmount) + amount);
        await tx.purchaseOrder.update({
          where: { id: adjustment.purchaseOrderId },
          data: {
            shippingAmount,
            taxAmount,
            totalAmount: round2(
              Number(order.subtotal) -
                Number(order.discountAmount) +
                taxAmount +
                shippingAmount
            ),
          },
        });
      }

      return applied;
    });
  }

  private async assertOrderExists(id: string) {
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw new NotFoundError('Purchase order not found');
  }
}
