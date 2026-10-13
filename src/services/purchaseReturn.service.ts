import type { PurchaseReturnStatus } from '@prisma/client';
import prisma from '@/config/database';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { warehouseWhere } from '@/utils/warehouseAccess';
import { EventsPublisher } from '@/publishers/events.publisher';
import { InventoryService } from '@/services/inventory.service';
import { generateDocumentNumber, round2 } from '@/services/purchaseOrder.service';

export type PurchaseReturnItemInput = {
  productId: string;
  variantId?: string;
  quantity: number;
  unitCost: number;
};

export class PurchaseReturnService {
  private readonly publisher = new EventsPublisher();
  private readonly inventoryService = new InventoryService();

  async list(params: {
    supplierId?: string;
    warehouseId?: string;
    warehouseIds?: string[];
    status?: PurchaseReturnStatus;
    limit?: number;
  } = {}) {
    return prisma.purchaseReturn.findMany({
      where: {
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...warehouseWhere(params.warehouseId, params.warehouseIds),
        ...(params.status ? { status: params.status } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async get(id: string) {
    const record = await prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!record) throw new NotFoundError('Purchase return not found');
    return record;
  }

  async create(input: {
    supplierId: string;
    warehouseId: string;
    purchaseOrderId?: string | null;
    reason?: string | null;
    createdBy?: string | null;
    items: PurchaseReturnItemInput[];
  }) {
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    if (input.items.length === 0) throw new ValidationError('At least one item is required');

    const items = input.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? '',
      quantity: item.quantity,
      unitCost: item.unitCost,
      lineTotal: round2(item.quantity * item.unitCost),
    }));

    return prisma.purchaseReturn.create({
      data: {
        returnNumber: generateDocumentNumber('PRN'),
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        reason: input.reason ?? null,
        createdBy: input.createdBy ?? null,
        items: { create: items },
      },
      include: { items: true },
    });
  }

  /**
   * Posting a return deducts stock (PURCHASE_RETURNED movements) and emits
   * `purchase.goods_returned` — all inside one transaction.
   */
  async post(id: string) {
    const record = await prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!record) throw new NotFoundError('Purchase return not found');
    if (record.status !== 'DRAFT') {
      throw new ValidationError('Only draft returns can be posted');
    }
    if (record.items.length === 0) {
      throw new ValidationError('Cannot post a return without items');
    }

    return prisma.$transaction(async (tx) => {
      const posted = await tx.purchaseReturn.update({
        where: { id },
        data: { status: 'POSTED', returnedAt: new Date() },
      });

      await this.inventoryService.applyGoodsReturnInTx(tx, {
        returnId: record.id,
        warehouseId: record.warehouseId,
        items: record.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
        })),
      });

      await this.publisher.publishPurchaseGoodsReturned({
        db: tx,
        data: {
          return_id: record.id,
          return_number: record.returnNumber,
          warehouse_id: record.warehouseId,
          supplier_id: record.supplierId,
          returned_at: new Date().toISOString(),
          items: record.items.map((item) => ({
            product_id: item.productId,
            variant_id: item.variantId || undefined,
            quantity: Number(item.quantity),
            unit_cost: Number(item.unitCost),
          })),
        },
      });

      return posted;
    });
  }
}