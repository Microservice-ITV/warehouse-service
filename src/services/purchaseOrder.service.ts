import type {
  AdditionalCostCategory,
  CostAllocationMethod,
  CostStatus,
  PurchaseCostAdjustmentType,
  PurchaseOrderStatus,
} from '@prisma/client';
import prisma from '@/config/database';
import { NotFoundError, ValidationError } from '@/utils/errors';

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
  async list(params: {
    status?: PurchaseOrderStatus;
    supplierId?: string;
    warehouseId?: string;
    limit?: number;
  } = {}) {
    return prisma.purchaseOrder.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
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
    supplierId: string;
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
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new NotFoundError('Supplier not found');
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

    return prisma.purchaseOrder.create({
      data: {
        orderNumber: generateDocumentNumber('PO'),
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        currency: input.currency ?? 'USD',
        exchangeRate: input.exchangeRate ?? 1,
        paymentTerms: input.paymentTerms ?? supplier.paymentTerms ?? null,
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
        items: { create: items },
        ...(deliveryStages.length > 0 ? { deliveryStages: { create: deliveryStages } } : {}),
        ...(additionalCosts.length > 0 ? { additionalCosts: { create: additionalCosts } } : {}),
        ...(attachments.length > 0 ? { attachments: { create: attachments } } : {}),
        statusHistory: {
          create: { status: 'DRAFT', changedBy: input.createdBy ?? null },
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
  }

  async setStatus(
    id: string,
    input: { status: PurchaseOrderStatus; note?: string; changedBy?: string }
  ) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { receipts: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.status === 'CANCELLED') {
      throw new ValidationError('Cancelled purchase orders cannot be updated');
    }
    if (input.status === 'CANCELLED' && order.receipts.length > 0) {
      throw new ValidationError('Cannot cancel a purchase order that has receipts');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'ORDERED' ? { orderedAt: new Date() } : {}),
        },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: id,
          status: input.status,
          note: input.note ?? null,
          changedBy: input.changedBy ?? null,
        },
      });
      return updated;
    });
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
