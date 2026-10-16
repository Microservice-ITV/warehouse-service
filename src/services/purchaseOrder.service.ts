import type {
  AdditionalCostCategory,
  CostAllocationMethod,
  CostStatus,
  PurchaseCostAdjustmentType,
  PurchaseOrderStatus,
} from '@prisma/client';
import prisma from '@/config/database';
import { InventoryService } from '@/services/inventory.service';
import { AppError, NotFoundError, ValidationError } from '@/utils/errors';
import { creditProductShopStock, type ShopStockCredit } from '@/clients/productStock.client';
import { parseVariantId, resolveVariantId, resolveVariantIdFromLine } from '@/utils/variantKey';
import { warehouseWhere } from '@/utils/warehouseAccess';
import { assertWarehouseCanAcceptUnits } from '@/utils/warehouseCapacity';
import { WarehouseRepository } from '@/repositories/warehouse.repository';

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
  colorId?: string | null;
  sizeId?: string | null;
  colorName?: string | null;
  sizeName?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
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
  private readonly warehouseRepository = new WarehouseRepository();

  async list(params: {
    status?: PurchaseOrderStatus;
    supplierId?: string;
    warehouseId?: string;
    warehouseIds?: string[];
    createdByIds?: string[];
    /** When set, only these order kinds (null treated as SUPPLIER in callers). */
    orderKinds?: Array<'WAREHOUSE' | 'SUPPLIER'>;
    limit?: number;
  } = {}) {
    return prisma.purchaseOrder.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...warehouseWhere(params.warehouseId, params.warehouseIds),
        ...(params.createdByIds ? { createdBy: { in: params.createdByIds } } : {}),
        ...(params.orderKinds && params.orderKinds.length > 0
          ? { orderKind: { in: params.orderKinds } }
          : {}),
      },
      include: {
        items: true,
        supplier: true,
        routeStops: { orderBy: { sequence: 'asc' } },
      },
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
        routeStops: { orderBy: { sequence: 'asc' } },
        deliveryHandoffs: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        damageReports: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
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
    routeStops?: string[];
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

    const routeStops = (input.routeStops ?? [])
      .map((location) => location.trim())
      .filter(Boolean);
    // Warehouse orders are local pulls — no transit route required.
    if (kind === 'SUPPLIER' && !input.asDraft && routeStops.length < 2) {
      throw new ValidationError(
        'Add at least two route stops (for example China → Lashio → Mandalay → Yangon).',
      );
    }

    const destination = await this.warehouseRepository.findById(input.warehouseId);
    if (!destination) throw new NotFoundError('Warehouse not found');
    // Supplier POs add units into the warehouse; warehouse orders pull stock out.
    if (!input.asDraft && kind === 'SUPPLIER') {
      const orderedUnits = input.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
      await assertWarehouseCanAcceptUnits(destination, orderedUnits, 'purchase');
    }

    const items = input.items.map((item) => {
      const gross = item.quantity * item.unitCost;
      const lineDiscount = item.discountAmount ?? 0;
      return {
        productId: item.productId,
        variantId: resolveVariantId({
          variantId: item.variantId,
          colorId: item.colorId,
          sizeId: item.sizeId,
          colorName: item.colorName,
          sizeName: item.sizeName,
        }),
        sku: item.sku ?? null,
        productName: item.productName ?? null,
        description: item.description ?? null,
        unit: item.unit ?? null,
        colorId: item.colorId ?? null,
        sizeId: item.sizeId ?? null,
        colorName: item.colorName ?? null,
        sizeName: item.sizeName ?? null,
        length: item.length ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
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
      kind === 'WAREHOUSE' && !input.asDraft
        ? await this.shortageNote(
            input.warehouseId,
            items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
            })),
          )
        : null;
    if (shortage) {
      throw new ValidationError(`Not enough stock in the warehouse. ${shortage}`);
    }
    const initialStatus = input.asDraft
      ? 'DRAFT'
      : kind === 'SUPPLIER'
        ? 'IN_TRANSIT'
        : 'PENDING_APPROVAL';
    const firstLegNote =
      routeStops.length >= 2
        ? `In transit ${routeStops[0]} → ${routeStops[1]}. Confirm arrival at each stop in Purchase Order Tracking.`
        : 'In transit. Confirm arrival at each stop in Purchase Order Tracking.';
    const historyNote = input.asDraft ? null : kind === 'SUPPLIER' ? firstLegNote : null;

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
          routeLegIndex: 0,
          items: { create: items },
          ...(routeStops.length > 0
            ? {
                routeStops: {
                  create: routeStops.map((location, index) => ({
                    sequence: index,
                    location,
                    // Origin is considered started; first destination is in transit.
                    arrivedAt: index === 0 ? new Date() : null,
                    arrivedBy: index === 0 ? (input.createdBy ?? null) : null,
                  })),
                },
              }
            : {}),
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
          routeStops: { orderBy: { sequence: 'asc' } },
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

  /**
   * Seller confirms arrival at the next route stop. Advances the active transit leg,
   * or marks the order ARRIVED when the final destination is reached.
   */
  async markRouteArrived(id: string, sellerUserId: string, changedBy?: string | null) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { routeStops: { orderBy: { sequence: 'asc' } } },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.orderKind !== 'SUPPLIER') {
      throw new ValidationError('Only supplier orders support route tracking');
    }
    if (order.status !== 'IN_TRANSIT' && order.status !== 'ORDERED') {
      throw new ValidationError('This order is not in transit');
    }
    if (order.createdBy && order.createdBy !== sellerUserId) {
      throw new ValidationError('Only the seller who placed this order can confirm arrival');
    }
    const stops = order.routeStops;
    if (stops.length < 2) {
      throw new ValidationError('This order has no route stops to track');
    }
    const legIndex = order.routeLegIndex ?? 0;
    const arrivalStop = stops[legIndex + 1];
    if (!arrivalStop) {
      throw new ValidationError('All route stops have already been confirmed');
    }
    if (arrivalStop.arrivedAt) {
      throw new ValidationError(`${arrivalStop.location} was already marked as arrived`);
    }

    const isFinalStop = legIndex + 1 >= stops.length - 1;
    const fromLocation = stops[legIndex]?.location ?? 'Origin';
    const toLocation = arrivalStop.location;
    const actor = changedBy ?? sellerUserId;

    return prisma.$transaction(async (tx) => {
      await tx.purchaseOrderRouteStop.update({
        where: { id: arrivalStop.id },
        data: { arrivedAt: new Date(), arrivedBy: actor },
      });

      if (isFinalStop) {
        const updated = await tx.purchaseOrder.update({
          where: { id },
          data: { status: 'ARRIVED', routeLegIndex: legIndex },
          include: {
            items: true,
            supplier: true,
            routeStops: { orderBy: { sequence: 'asc' } },
          },
        });
        await tx.purchaseOrderStatusHistory.create({
          data: {
            purchaseOrderId: id,
            status: 'ARRIVED',
            note: `Arrived at final stop ${toLocation} (from ${fromLocation}). Waiting for the delivery agent to pick up.`,
            changedBy: actor,
          },
        });
        return updated;
      }

      const nextLeg = legIndex + 1;
      const nextFrom = stops[nextLeg]?.location ?? toLocation;
      const nextTo = stops[nextLeg + 1]?.location ?? 'next stop';
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'IN_TRANSIT', routeLegIndex: nextLeg },
        include: {
          items: true,
          supplier: true,
          routeStops: { orderBy: { sequence: 'asc' } },
        },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: id,
          status: 'IN_TRANSIT',
          note: `Arrived at ${toLocation}. Now in transit ${nextFrom} → ${nextTo}.`,
          changedBy: actor,
        },
      });
      return updated;
    });
  }

  /** @deprecated Supplier stock now goes delivery agent → seller → warehouse transfer. */
  async receiveSupplierStock(_id: string, _changedBy?: string | null) {
    throw new ValidationError(
      'Supplier products are received by the delivery agent, then the seller. Send them to a warehouse with Transfer.',
    );
  }

  async deliveryAgentPickup(id: string, changedBy?: string | null) {
    const order = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.orderKind !== 'SUPPLIER') {
      throw new ValidationError('Only a supplier order can be picked up by a delivery agent');
    }
    if (order.status !== 'ARRIVED') {
      throw new ValidationError(
        'Wait until the seller marks the parcel as arrived at the final route stop before pickup',
      );
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'DELIVERY_PICKED_UP' },
        include: { items: true, supplier: true, routeStops: { orderBy: { sequence: 'asc' } } },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: id,
          status: 'DELIVERY_PICKED_UP',
          note: 'Delivery agent picked up the parcel at the final destination to deliver to the warehouse.',
          changedBy: changedBy ?? null,
        },
      });
      return updated;
    });
  }

  async deliveryAgentMarkProcessed(
    id: string,
    input: {
      confirmedBy: string;
      notes?: string | null;
      items: Array<{
        purchaseOrderItemId: string;
        confirmedQty: number;
        variationCorrect: boolean;
        notes?: string | null;
      }>;
    },
  ) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.orderKind !== 'SUPPLIER') {
      throw new ValidationError('Only a supplier order can be processed by a delivery agent');
    }
    if (order.status !== 'ARRIVED' && order.status !== 'DELIVERY_PICKED_UP') {
      throw new ValidationError(
        'Confirm and pickup is available after the seller marks the parcel arrived at the final stop',
      );
    }
    if (!input.confirmedBy.trim()) {
      throw new ValidationError('Delivery agent identity is required');
    }

    const orderItemById = new Map(order.items.map((item) => [item.id, item]));
    if (input.items.length !== order.items.length) {
      throw new ValidationError('Confirm every product line on this parcel');
    }
    const seen = new Set<string>();
    for (const line of input.items) {
      if (seen.has(line.purchaseOrderItemId)) {
        throw new ValidationError('Duplicate product line in confirmation');
      }
      seen.add(line.purchaseOrderItemId);
      const orderItem = orderItemById.get(line.purchaseOrderItemId);
      if (!orderItem) {
        throw new ValidationError('Confirmation includes a product that is not on this order');
      }
      if (!line.variationCorrect) {
        throw new ValidationError(
          `Confirm the variation is correct for ${orderItem.productName || orderItem.productId}`,
        );
      }
      if (line.confirmedQty > orderItem.quantity) {
        throw new ValidationError(
          `Confirmed quantity cannot exceed ordered quantity for ${orderItem.productName || orderItem.productId}`,
        );
      }
    }
    for (const orderItem of order.items) {
      if (!seen.has(orderItem.id)) {
        throw new ValidationError('Confirm every product line on this parcel');
      }
    }

    return prisma.$transaction(async (tx) => {
      // Combined confirm + pickup: record pickup when the agent still had ARRIVED.
      if (order.status === 'ARRIVED') {
        await tx.purchaseOrderStatusHistory.create({
          data: {
            purchaseOrderId: id,
            status: 'DELIVERY_PICKED_UP',
            note: 'Delivery agent confirmed and picked up the parcel at the final destination.',
            changedBy: input.confirmedBy,
          },
        });
      }

      await tx.deliveryHandoff.create({
        data: {
          purchaseOrderId: id,
          confirmedBy: input.confirmedBy,
          notes: input.notes ?? null,
          items: {
            create: input.items.map((line) => {
              const orderItem = orderItemById.get(line.purchaseOrderItemId)!;
              return {
                purchaseOrderItemId: orderItem.id,
                productId: orderItem.productId,
                variantId: orderItem.variantId || '',
                productName: orderItem.productName,
                colorName: orderItem.colorName,
                sizeName: orderItem.sizeName,
                orderedQty: orderItem.quantity,
                confirmedQty: line.confirmedQty,
                variationCorrect: line.variationCorrect,
                notes: line.notes ?? null,
              };
            }),
          },
        },
      });

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'AWAITING_WAREHOUSE_RECEIPT' },
        include: {
          items: true,
          supplier: true,
          routeStops: { orderBy: { sequence: 'asc' } },
          deliveryHandoffs: {
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: id,
          status: 'AWAITING_WAREHOUSE_RECEIPT',
          note: 'Delivery agent confirmed variation and quantity, then sent the parcel to the warehouse manager.',
          changedBy: input.confirmedBy,
        },
      });
      return updated;
    });
  }

  private static readonly SHOP_STOCK_CREDITED_NOTE = 'Shop stock credited in product catalog.';

  private shopCreditsFromLines(
    lines: Array<{ productId: string; variantId?: string | null; quantity: number }>,
  ): ShopStockCredit[] {
    return lines
      .filter((line) => line.quantity > 0)
      .map((line) => {
        const inventoryVariantId = line.variantId ?? '';
        const parsed = parseVariantId(inventoryVariantId);
        return {
          productId: line.productId,
          inventoryVariantId: inventoryVariantId || undefined,
          colorId: parsed.colorId || undefined,
          sizeId: parsed.sizeId || undefined,
          quantity: line.quantity,
        };
      });
  }

  private async markShopStockCredited(purchaseOrderId: string, changedBy?: string | null) {
    await prisma.purchaseOrderStatusHistory.create({
      data: {
        purchaseOrderId,
        status: 'RECEIVED',
        note: PurchaseOrderService.SHOP_STOCK_CREDITED_NOTE,
        changedBy: changedBy ?? null,
      },
    });
  }

  /**
   * Seller receives an accepted warehouse order: warehouse stock ↓, product shop stock ↑.
   * Supplier parcels are still received by the warehouse manager (goods receipt).
   * If warehouse stock was already issued but shop credit failed, Receive retries credit only.
   */
  async sellerReceiveFromDelivery(id: string, sellerUserId: string, changedBy?: string | null) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: true,
        receipts: { include: { items: true }, orderBy: { createdAt: 'desc' } },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.orderKind !== 'WAREHOUSE') {
      throw new ValidationError(
        'Sellers no longer receive supplier parcels. The warehouse manager posts the goods receipt after the delivery agent delivers the parcel.',
      );
    }
    if (order.createdBy && order.createdBy !== sellerUserId) {
      throw new AppError('Only the seller who requested this order can receive it', 403, 'FORBIDDEN');
    }

    const postedReceipt = order.receipts.find((receipt) => receipt.status === 'POSTED');
    if (postedReceipt) {
      const alreadyCredited = order.statusHistory.some(
        (entry) => entry.note === PurchaseOrderService.SHOP_STOCK_CREDITED_NOTE,
      );
      if (alreadyCredited) {
        return postedReceipt;
      }
      // Prior attempt reduced warehouse stock but shop credit may have failed — retry credit only.
      const credits = this.shopCreditsFromLines(
        postedReceipt.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.acceptedQty ?? item.quantity,
        })),
      );
      try {
        await creditProductShopStock(credits);
        await this.markShopStockCredited(order.id, changedBy ?? sellerUserId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        throw new AppError(
          `Warehouse stock was already issued, but shop stock credit failed (${detail}). Try Receive again.`,
          502,
          'SHOP_STOCK_CREDIT_FAILED',
        );
      }
      return postedReceipt;
    }

    if (!['AWAITING_SELLER_RECEIPT', 'ORDERED', 'APPROVED'].includes(order.status)) {
      throw new ValidationError(
        'Receive is only available after the warehouse manager accepts this request',
      );
    }

    const openItems = order.items
      .map((item) => ({
        ...item,
        openQty: item.quantity - item.receivedQty,
      }))
      .filter((item) => item.openQty > 0);
    if (openItems.length === 0) {
      throw new ValidationError('Nothing left to receive on this order');
    }

    const shortage = await this.shortageNote(
      order.warehouseId,
      openItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        colorName: item.colorName,
        sizeName: item.sizeName,
        quantity: item.openQty,
      })),
    );
    if (shortage) {
      await this.setStatus(id, {
        status: 'LOW_STOCK',
        note: shortage,
        changedBy: changedBy ?? sellerUserId,
      });
      throw new ValidationError(shortage);
    }

    const actor = changedBy ?? sellerUserId;
    const shopCredits: ShopStockCredit[] = [];

    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseReceipt.create({
        data: {
          receiptNumber: generateDocumentNumber('GRN'),
          purchaseOrderId: order.id,
          warehouseId: order.warehouseId,
          status: 'POSTED',
          receivedAt: new Date(),
          createdBy: actor,
          items: {
            create: openItems.map((item) => ({
              purchaseOrderItemId: item.id,
              productId: item.productId,
              variantId: item.variantId ?? '',
              quantity: item.openQty,
              acceptedQty: item.openQty,
              rejectedQty: 0,
              unitCost: item.unitCost,
              lineTotal: round2(item.openQty * Number(item.unitCost)),
            })),
          },
        },
        include: { items: true },
      });

      for (const item of openItems) {
        const issued = await this.inventoryService.issueSale(tx, {
          warehouseId: order.warehouseId,
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.openQty,
          referenceId: created.id,
          createdBy: actor,
        });
        for (const part of issued) {
          const inventoryVariantId = part.variantId || item.variantId || '';
          const parsed = parseVariantId(inventoryVariantId);
          shopCredits.push({
            productId: item.productId,
            inventoryVariantId: inventoryVariantId || undefined,
            colorId: parsed.colorId || undefined,
            sizeId: parsed.sizeId || undefined,
            quantity: part.quantity,
          });
          if (order.createdBy) {
            await this.inventoryService.creditSellerStock(tx, {
              userId: order.createdBy,
              productId: item.productId,
              variantId: inventoryVariantId,
              quantity: part.quantity,
            });
          }
        }
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: item.openQty } },
        });
      }

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: 'RECEIVED' },
      });
      await tx.purchaseOrderStatusHistory.create({
        data: {
          purchaseOrderId: order.id,
          status: 'RECEIVED',
          note: 'Seller received stock from the warehouse into shop inventory.',
          changedBy: actor,
        },
      });

      return created;
    });

    try {
      await creditProductShopStock(shopCredits);
      await this.markShopStockCredited(order.id, actor);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new AppError(
        `Warehouse stock was issued, but shop stock credit failed (${detail}). Click Receive again to finish.`,
        502,
        'SHOP_STOCK_CREDIT_FAILED',
      );
    }

    return receipt;
  }

  async createDamageReport(input: {
    purchaseOrderId: string;
    reportedBy: string;
    notes?: string | null;
    items: Array<{
      purchaseOrderItemId?: string | null;
      productId: string;
      variantId?: string;
      productName?: string | null;
      quantity: number;
      damageType?: string | null;
      notes?: string | null;
    }>;
  }) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.orderKind !== 'SUPPLIER') {
      throw new ValidationError('Damage reports are only for supplier parcels');
    }
    if (
      ![
        'IN_TRANSIT',
        'ARRIVED',
        'ORDERED',
        'DELIVERY_PICKED_UP',
        'AWAITING_WAREHOUSE_RECEIPT',
        'AWAITING_SELLER_RECEIPT',
      ].includes(order.status)
    ) {
      throw new ValidationError('This order is not open for a damage report');
    }
    if (input.items.length === 0) {
      throw new ValidationError('Add at least one damaged product line');
    }

    return prisma.damageReport.create({
      data: {
        reportNumber: generateDocumentNumber('DMG'),
        purchaseOrderId: input.purchaseOrderId,
        reportedBy: input.reportedBy,
        notes: input.notes ?? null,
        status: 'SUBMITTED',
        items: {
          create: input.items.map((item) => {
            const orderItem = item.purchaseOrderItemId
              ? order.items.find((line) => line.id === item.purchaseOrderItemId)
              : undefined;
            return {
              purchaseOrderItemId: item.purchaseOrderItemId ?? null,
              productId: item.productId,
              variantId: resolveVariantIdFromLine(orderItem, item.variantId),
              productName: item.productName ?? null,
              quantity: item.quantity,
              damageType: item.damageType ?? null,
              notes: item.notes ?? null,
            };
          }),
        },
      },
      include: { items: true },
    });
  }

  async listDamageReports(params: {
    purchaseOrderId?: string;
    sellerUserIds?: string[];
    reportedBy?: string;
    limit?: number;
  }) {
    return prisma.damageReport.findMany({
      where: {
        ...(params.purchaseOrderId ? { purchaseOrderId: params.purchaseOrderId } : {}),
        ...(params.reportedBy ? { reportedBy: params.reportedBy } : {}),
        ...(params.sellerUserIds
          ? { purchaseOrder: { createdBy: { in: params.sellerUserIds } } }
          : {}),
      },
      include: {
        items: true,
        purchaseOrder: { select: { id: true, orderNumber: true, createdBy: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async getDamageReport(id: string) {
    const report = await prisma.damageReport.findUnique({
      where: { id },
      include: {
        items: true,
        purchaseOrder: { include: { items: true, supplier: true } },
      },
    });
    if (!report) throw new NotFoundError('Damage report not found');
    return report;
  }

  /**
   * Seller confirms a delivery-agent damage report. When the parcel was already
   * received into the PO warehouse, damaged quantities are removed from that
   * warehouse. Otherwise the reduction is applied on goods receipt.
   */
  async confirmDamageReport(id: string, sellerUserId: string) {
    const report = await prisma.damageReport.findUnique({
      where: { id },
      include: {
        items: true,
        purchaseOrder: {
          select: {
            id: true,
            createdBy: true,
            status: true,
            orderKind: true,
            warehouseId: true,
          },
        },
      },
    });
    if (!report) throw new NotFoundError('Damage report not found');
    if (report.status === 'CONFIRMED') {
      throw new ValidationError('This damage report is already confirmed');
    }
    if (report.status !== 'SUBMITTED') {
      throw new ValidationError('Only a submitted damage report can be confirmed');
    }
    if (report.purchaseOrder.orderKind !== 'SUPPLIER') {
      throw new ValidationError('Damage reports are only for supplier parcels');
    }
    if (!report.purchaseOrder.createdBy || report.purchaseOrder.createdBy !== sellerUserId) {
      throw new ValidationError('Only the seller who placed this order can confirm the report');
    }
    if (report.items.length === 0) {
      throw new ValidationError('This damage report has no damaged products');
    }

    return prisma.$transaction(async (tx) => {
      const alreadyReceived = report.purchaseOrder.status === 'SELLER_RECEIVED';
      if (alreadyReceived) {
        await this.inventoryService.applyGoodsReturnInTx(tx, {
          returnId: `damage-${report.id}`,
          warehouseId: report.purchaseOrder.warehouseId,
          items: report.items
            .filter((item) => item.quantity > 0)
            .map((item) => ({
              productId: item.productId,
              variantId: item.variantId || undefined,
              quantity: item.quantity,
              unitCost: 0,
            })),
        });
        for (const item of report.items) {
          if (!item.purchaseOrderItemId || item.quantity <= 0) continue;
          const line = await tx.purchaseOrderItem.findUnique({
            where: { id: item.purchaseOrderItemId },
          });
          if (line) {
            await tx.purchaseOrderItem.update({
              where: { id: line.id },
              data: {
                acceptedQty: Math.max(0, (line.acceptedQty ?? line.quantity) - item.quantity),
              },
            });
          }
        }
      }

      return tx.damageReport.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedBy: sellerUserId,
          confirmedAt: new Date(),
          ...(alreadyReceived ? { stockReducedAt: new Date() } : {}),
        },
        include: {
          items: true,
          purchaseOrder: {
            select: { id: true, orderNumber: true, createdBy: true, status: true },
          },
        },
      });
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
        input.status === 'ORDERED' ||
        input.status === 'AWAITING_SELLER_RECEIPT');
    if (checksWarehouse) {
      const shortage = await this.shortageNote(order.warehouseId, order.items);
      if (shortage) {
        nextStatus = 'LOW_STOCK';
        note = shortage;
      } else if (input.status === 'APPROVED' || input.status === 'ORDERED') {
        // WM accepted — seller can receive into shop stock next.
        nextStatus = 'AWAITING_SELLER_RECEIPT';
        note =
          note ??
          'Warehouse manager accepted the request. The seller can receive the products into shop stock.';
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(nextStatus === 'ORDERED' || nextStatus === 'AWAITING_SELLER_RECEIPT'
            ? { orderedAt: new Date() }
            : {}),
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

  private async shortageNote(
    warehouseId: string,
    items: Array<{
      productId: string;
      productName: string | null;
      quantity: number;
      variantId?: string | null;
      colorName?: string | null;
      sizeName?: string | null;
    }>,
  ): Promise<string | null> {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    const warehouseName = warehouse?.name ?? 'this warehouse';
    const lines: string[] = [];
    for (const item of items) {
      const available = await this.inventoryService.availableQty(
        warehouseId,
        item.productId,
        undefined,
        item.variantId,
      );
      if (available < item.quantity) {
        const variation = [item.colorName, item.sizeName].filter((part) => part?.trim()).join(' / ');
        const base = item.productName?.trim() || 'A product';
        const label = variation ? `${base} (${variation})` : base;
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
