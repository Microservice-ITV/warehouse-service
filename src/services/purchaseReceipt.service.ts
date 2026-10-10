import prisma from '@/config/database';
import type { PurchaseReceiptStatus } from '@prisma/client';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { EventsPublisher } from '@/publishers/events.publisher';
import { InventoryService } from '@/services/inventory.service';
import { generateDocumentNumber, round2 } from '@/services/purchaseOrder.service';

export type PurchaseReceiptItemInput = {
  purchaseOrderItemId?: string;
  productId: string;
  variantId?: string;
  quantity: number;
  acceptedQty?: number | null;
  rejectedQty?: number | null;
  unitCost: number;
  batchNumber?: string | null;
  expiryAt?: string | null;
};

export class PurchaseReceiptService {
  private readonly publisher = new EventsPublisher();
  private readonly inventoryService = new InventoryService();

  async list(params: {
    purchaseOrderId?: string;
    warehouseId?: string;
    status?: PurchaseReceiptStatus;
    limit?: number;
  } = {}) {
    return prisma.purchaseReceipt.findMany({
      where: {
        ...(params.purchaseOrderId ? { purchaseOrderId: params.purchaseOrderId } : {}),
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async get(id: string) {
    const receipt = await prisma.purchaseReceipt.findUnique({
      where: { id },
      include: { items: true, purchaseOrder: true },
    });
    if (!receipt) throw new NotFoundError('Purchase receipt not found');
    return receipt;
  }

  async create(input: {
    purchaseOrderId: string;
    warehouseId?: string;
    notes?: string | null;
    createdBy?: string | null;
    items: PurchaseReceiptItemInput[];
  }) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (input.items.length === 0) throw new ValidationError('At least one item is required');

    const items = input.items.map((item) => ({
      purchaseOrderItemId: item.purchaseOrderItemId ?? null,
      productId: item.productId,
      variantId: item.variantId ?? '',
      quantity: item.quantity,
      acceptedQty: item.acceptedQty ?? null,
      rejectedQty: item.rejectedQty ?? 0,
      unitCost: item.unitCost,
      lineTotal: round2(item.quantity * item.unitCost),
      batchNumber: item.batchNumber ?? null,
      expiryAt: item.expiryAt ? new Date(item.expiryAt) : null,
    }));

    return prisma.purchaseReceipt.create({
      data: {
        receiptNumber: generateDocumentNumber('GRN'),
        purchaseOrderId: input.purchaseOrderId,
        warehouseId: input.warehouseId ?? order.warehouseId,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
        items: { create: items },
      },
      include: { items: true },
    });
  }

  /**
   * Confirm a GRN. Inside a single transaction it bumps the purchase order's
   * received quantities, marks the order fully/partially received, records the
   * positive inventory movement (`PURCHASE_RECEIVED`) and enqueues the
   * `purchase.goods_received` outbox event.
   */
  async confirm(id: string) {
    const receipt = await prisma.purchaseReceipt.findUnique({
      where: { id },
      include: { items: true, purchaseOrder: true },
    });
    if (!receipt) throw new NotFoundError('Purchase receipt not found');
    if (receipt.status !== 'DRAFT') {
      throw new ValidationError('Only draft receipts can be confirmed');
    }
    if (receipt.items.length === 0) {
      throw new ValidationError('Cannot confirm a receipt without items');
    }

    return prisma.$transaction(async (tx) => {
      const effectiveItems = receipt.items.map((item) => ({
        ...item,
        effectiveQty: item.acceptedQty ?? item.quantity,
      }));

      for (const item of effectiveItems) {
        if (item.purchaseOrderItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId },
            data: {
              receivedQty: { increment: item.effectiveQty },
              acceptedQty: { increment: item.effectiveQty },
              rejectedQty: { increment: item.rejectedQty ?? 0 },
            },
          });
        }
      }

      const orderItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: receipt.purchaseOrderId },
      });
      const fullyReceived = orderItems.every((item) => item.receivedQty >= item.quantity);

      await tx.purchaseOrder.update({
        where: { id: receipt.purchaseOrderId },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      const updated = await tx.purchaseReceipt.update({
        where: { id },
        data: { status: 'POSTED', receivedAt: new Date() },
        include: { items: true },
      });

      await this.inventoryService.applyGoodsReceiptInTx(tx, {
        receiptId: receipt.id,
        warehouseId: receipt.warehouseId,
        items: effectiveItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.effectiveQty,
          unitCost: Number(item.unitCost),
        })),
      });

      await this.publisher.publishPurchaseGoodsReceived({
        db: tx,
        data: {
          receipt_id: receipt.id,
          receipt_number: receipt.receiptNumber,
          purchase_order_id: receipt.purchaseOrderId,
          warehouse_id: receipt.warehouseId,
          supplier_id: receipt.purchaseOrder.supplierId,
          received_at: new Date().toISOString(),
          items: effectiveItems.map((item) => ({
            product_id: item.productId,
            variant_id: item.variantId || undefined,
            quantity: item.effectiveQty,
            unit_cost: Number(item.unitCost),
          })),
        },
      });

      return updated;
    });
  }
}