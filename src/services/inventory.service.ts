import type { InventoryStock, MovementType, Prisma, TransferStatus } from '@prisma/client';
import prisma from '@/config/database';
import env from '@/config/env';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { MovementRepository } from '@/repositories/movement.repository';
import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { TransferRepository } from '@/repositories/transfer.repository';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { EventsPublisher } from '@/publishers/events.publisher';
import { NotFoundError, ValidationError } from '@/utils/errors';

type Db = Prisma.TransactionClient | typeof prisma;

export const toAvailabilityStatus = (availableQty: number) => {
  if (availableQty <= 0) return 'OUT_OF_STOCK';
  if (availableQty <= 5) return 'LOW_STOCK';
  return 'IN_STOCK';
};

const INBOUND_MOVEMENT_TYPES: MovementType[] = [
  'PURCHASE_RECEIVED',
  'RETURN_RECEIVED',
  'INITIAL_BALANCE',
];

export const withAvailability = (stock: InventoryStock) => ({
  ...stock,
  availability: toAvailabilityStatus(stock.availableQty),
});

export class InventoryService {
  private readonly inventoryRepository = new InventoryRepository();
  private readonly movementRepository = new MovementRepository();
  private readonly productSnapshotRepository = new ProductSnapshotRepository();
  private readonly transferRepository = new TransferRepository();
  private readonly warehouseRepository = new WarehouseRepository();
  private readonly eventsPublisher = new EventsPublisher();
  private readonly threshold = env.LOW_STOCK_THRESHOLD;

  /**
   * Ensures inventory rows exist for this product in every active warehouse (starting at 0).
   * Called when catalog events create/update a product snapshot.
   * Note: warehouses are no longer shop-scoped, so `shopId` is informational only.
   */
  async ensureInventoryRowsForProduct(input: { productId: string; shopId: string }) {
    const warehouses = await this.warehouseRepository.list({ status: 'ACTIVE' });
    if (warehouses.length === 0) return;

    await prisma.$transaction(async (tx) => {
      for (const warehouse of warehouses) {
        await this.inventoryRepository.ensureRow(warehouse.id, input.productId, '', tx);
      }
    });
  }

  async maybePublishLowStock(params: {
    warehouseId: string;
    productId: string;
    shopId: string;
    availableStock: number;
    correlationId: string;
    db?: Db;
  }) {
    if (params.availableStock >= this.threshold) return;
    await this.eventsPublisher.publishInventoryLowStock({
      productId: params.productId,
      shopId: params.shopId,
      warehouseId: params.warehouseId,
      availableStock: params.availableStock,
      threshold: this.threshold,
      correlationId: params.correlationId,
      db: params.db,
    });
  }

  async listWarehouseInventory(warehouseId: string) {
    const warehouse = await this.warehouseRepository.findById(warehouseId);
    if (!warehouse) throw new NotFoundError('Warehouse not found');
    const stocks = await this.inventoryRepository.listByWarehouse(warehouseId);
    return stocks.map(withAvailability);
  }

  async listMovements(input: {
    productId?: string;
    warehouseId?: string;
    movementType?: MovementType;
    limit?: number;
  }) {
    return this.movementRepository.list(input);
  }

  async listTransfers(input: {
    warehouseId?: string;
    status?: TransferStatus;
    limit?: number;
  }) {
    return this.transferRepository.list(input);
  }

  async increaseStock(input: {
    warehouseId: string;
    productId: string;
    variantId?: string;
    quantity: number;
    referenceId: string;
    movementType?: MovementType;
    referenceType?: string;
    unitCost?: number;
    createdBy?: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');
    const movementType = input.movementType ?? 'PURCHASE_RECEIVED';
    if (!INBOUND_MOVEMENT_TYPES.includes(movementType)) {
      throw new ValidationError(
        `movementType must be one of: ${INBOUND_MOVEMENT_TYPES.join(', ')}`
      );
    }

    return prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('Warehouse not found');

      const { beforeQty, afterQty, stock } = await this.applyDelta(tx, {
        warehouseId: input.warehouseId,
        productId: input.productId,
        variantId: input.variantId,
        delta: input.quantity,
      });

      await this.movementRepository.create({
        warehouseId: input.warehouseId,
        productId: input.productId,
        variantId: input.variantId,
        movementType,
        quantity: afterQty - beforeQty,
        beforeQty,
        afterQty,
        referenceType: input.referenceType ?? 'MANUAL',
        referenceId: input.referenceId,
        unitCost: input.unitCost,
        createdBy: input.createdBy,
        db: tx,
      });

      await this.publishStockChange(tx, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        correlationId: input.referenceId,
        localAvailable: stock.availableQty,
      });

      return withAvailability(stock);
    });
  }

  /**
   * Registers a transfer request. Stock is NOT moved until a warehouse approves it
   * (see `approveTransfer`), so the transfer starts in PENDING status.
   */
  async requestTransfer(input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    productId: string;
    variantId?: string;
    quantity: number;
    referenceId: string;
    referenceType?: string;
    requestedBy?: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new ValidationError('Source and destination warehouses must be different');
    }

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.warehouseRepository.findById(input.fromWarehouseId),
      this.warehouseRepository.findById(input.toWarehouseId),
    ]);
    if (!fromWarehouse) throw new NotFoundError('Source warehouse not found');
    if (!toWarehouse) throw new NotFoundError('Destination warehouse not found');

    return this.transferRepository.create({
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      productId: input.productId,
      variantId: input.variantId,
      quantity: input.quantity,
      referenceId: input.referenceId,
      referenceType: input.referenceType ?? 'TRANSFER',
      requestedBy: input.requestedBy,
    });
  }

  async rejectTransfer(input: { transferId: string; decidedBy?: string; note?: string }) {
    const transfer = await this.transferRepository.findById(input.transferId);
    if (!transfer) throw new NotFoundError('Transfer not found');
    if (transfer.status !== 'PENDING') {
      throw new ValidationError(`Transfer is already ${transfer.status.toLowerCase()}`);
    }
    return this.transferRepository.decide(input.transferId, {
      decidedBy: input.decidedBy,
      note: input.note,
      status: 'REJECTED',
    });
  }

  /**
   * Approves a pending transfer: atomically moves the stock and writes the paired
   * TRANSFER_OUT / TRANSFER_IN movements, then marks the transfer APPROVED.
   */
  async approveTransfer(input: { transferId: string; decidedBy?: string; note?: string }) {
    return prisma.$transaction(async (tx) => {
      const transfer = await this.transferRepository.findById(input.transferId, tx);
      if (!transfer) throw new NotFoundError('Transfer not found');
      if (transfer.status !== 'PENDING') {
        throw new ValidationError(`Transfer is already ${transfer.status.toLowerCase()}`);
      }

      const [fromWarehouse, toWarehouse] = await Promise.all([
        this.warehouseRepository.findById(transfer.fromWarehouseId, tx),
        this.warehouseRepository.findById(transfer.toWarehouseId, tx),
      ]);
      if (!fromWarehouse) throw new NotFoundError('Source warehouse not found');
      if (!toWarehouse) throw new NotFoundError('Destination warehouse not found');

      const referenceId = transfer.referenceId ?? transfer.id;
      const variantId = transfer.variantId || undefined;

      const source = await this.applyDelta(tx, {
        warehouseId: transfer.fromWarehouseId,
        productId: transfer.productId,
        variantId,
        delta: -transfer.quantity,
        minAvailable: transfer.quantity,
        errorMessage: 'Insufficient available stock in source warehouse',
      });

      const destination = await this.applyDelta(tx, {
        warehouseId: transfer.toWarehouseId,
        productId: transfer.productId,
        variantId,
        delta: transfer.quantity,
      });

      await this.movementRepository.create({
        warehouseId: transfer.fromWarehouseId,
        productId: transfer.productId,
        variantId,
        movementType: 'TRANSFER_OUT',
        quantity: source.afterQty - source.beforeQty,
        beforeQty: source.beforeQty,
        afterQty: source.afterQty,
        referenceType: transfer.referenceType ?? 'TRANSFER',
        referenceId,
        createdBy: input.decidedBy ?? transfer.requestedBy,
        db: tx,
      });

      await this.movementRepository.create({
        warehouseId: transfer.toWarehouseId,
        productId: transfer.productId,
        variantId,
        movementType: 'TRANSFER_IN',
        quantity: destination.afterQty - destination.beforeQty,
        beforeQty: destination.beforeQty,
        afterQty: destination.afterQty,
        referenceType: transfer.referenceType ?? 'TRANSFER',
        referenceId,
        createdBy: input.decidedBy ?? transfer.requestedBy,
        db: tx,
      });

      const shopId = await this.publishStockChange(tx, {
        productId: transfer.productId,
        warehouseId: transfer.fromWarehouseId,
        correlationId: referenceId,
        localAvailable: source.stock.availableQty,
      });
      if (shopId) {
        await this.maybePublishLowStock({
          warehouseId: transfer.toWarehouseId,
          productId: transfer.productId,
          shopId,
          availableStock: destination.stock.availableQty,
          correlationId: referenceId,
          db: tx,
        });
      }

      const updated = await this.transferRepository.decide(transfer.id, {
        decidedBy: input.decidedBy,
        note: input.note,
        status: 'APPROVED',
      });

      return {
        transfer: updated,
        fromWarehouse: withAvailability(source.stock),
        toWarehouse: withAvailability(destination.stock),
      };
    });
  }

  async receiveStock(input: {
    warehouseId: string;
    productId: string;
    variantId?: string;
    quantity: number;
    referenceId: string;
    referenceType?: string;
    unitCost?: number;
    createdBy?: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');

    return prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('Warehouse not found');

      const { beforeQty, afterQty, stock } = await this.applyDelta(tx, {
        warehouseId: input.warehouseId,
        productId: input.productId,
        variantId: input.variantId,
        delta: input.quantity,
      });

      await this.movementRepository.create({
        warehouseId: input.warehouseId,
        productId: input.productId,
        variantId: input.variantId,
        movementType: 'PURCHASE_RECEIVED',
        quantity: afterQty - beforeQty,
        beforeQty,
        afterQty,
        referenceType: input.referenceType ?? 'PURCHASE_RECEIPT',
        referenceId: input.referenceId,
        unitCost: input.unitCost,
        createdBy: input.createdBy,
        db: tx,
      });

      await this.publishStockChange(tx, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        correlationId: input.referenceId,
        localAvailable: stock.availableQty,
      });

      return withAvailability(stock);
    });
  }

  /**
   * Applies the inventory effect of a confirmed GRN inside an existing transaction.
   * Idempotent: if movements for this receipt already exist nothing is applied.
   */
  async applyGoodsReceiptInTx(
    tx: Prisma.TransactionClient,
    input: {
      receiptId: string;
      warehouseId: string;
      items: Array<{
        productId: string;
        variantId?: string;
        quantity: number;
        unitCost: number;
      }>;
    }
  ) {
    const existing = await this.movementRepository.countByReference(input.receiptId, tx);
    if (existing > 0) {
      return { skipped: true, processed: 0 };
    }

    const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
    if (!warehouse) throw new NotFoundError('Warehouse not found');

    let processed = 0;
    for (const item of input.items) {
      if (item.quantity <= 0) continue;

      const { beforeQty, afterQty, stock } = await this.applyDelta(tx, {
        warehouseId: input.warehouseId,
        productId: item.productId,
        variantId: item.variantId,
        delta: item.quantity,
      });

      await this.movementRepository.create({
        warehouseId: input.warehouseId,
        productId: item.productId,
        variantId: item.variantId,
        movementType: 'PURCHASE_RECEIVED',
        quantity: afterQty - beforeQty,
        beforeQty,
        afterQty,
        referenceType: 'PURCHASE_RECEIPT',
        referenceId: input.receiptId,
        unitCost: item.unitCost,
        db: tx,
      });

      await this.publishStockChange(tx, {
        productId: item.productId,
        warehouseId: input.warehouseId,
        correlationId: input.receiptId,
        localAvailable: stock.availableQty,
      });

      processed += 1;
    }

    return { skipped: false, processed };
  }

  /**
   * Records the inventory effect of a confirmed GRN (`purchase.goods_received`).
   * Idempotent: if movements for this receipt already exist the whole message is a no-op.
   */
  async receivePurchaseGoods(input: {
    receiptId: string;
    receiptNumber?: string;
    warehouseId: string;
    supplierId?: string;
    items: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
      unitCost: number;
    }>;
  }) {
    return prisma.$transaction((tx) => this.applyGoodsReceiptInTx(tx, input));
  }

  /**
   * Applies the inventory effect of a posted supplier return (deducts stock) inside
   * an existing transaction. Idempotent on the return id.
   */
  async applyGoodsReturnInTx(
    tx: Prisma.TransactionClient,
    input: {
      returnId: string;
      warehouseId: string;
      items: Array<{
        productId: string;
        variantId?: string;
        quantity: number;
        unitCost: number;
      }>;
    }
  ) {
    const existing = await this.movementRepository.countByReference(input.returnId, tx);
    if (existing > 0) {
      return { skipped: true, processed: 0 };
    }

    const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
    if (!warehouse) throw new NotFoundError('Warehouse not found');

    let processed = 0;
    for (const item of input.items) {
      if (item.quantity <= 0) continue;

      const { beforeQty, afterQty, stock } = await this.applyDelta(tx, {
        warehouseId: input.warehouseId,
        productId: item.productId,
        variantId: item.variantId,
        delta: -item.quantity,
        minAvailable: item.quantity,
        errorMessage: 'Insufficient available stock to return',
      });

      await this.movementRepository.create({
        warehouseId: input.warehouseId,
        productId: item.productId,
        variantId: item.variantId,
        movementType: 'PURCHASE_RETURNED',
        quantity: afterQty - beforeQty,
        beforeQty,
        afterQty,
        referenceType: 'PURCHASE_RETURN',
        referenceId: input.returnId,
        unitCost: item.unitCost,
        db: tx,
      });

      await this.publishStockChange(tx, {
        productId: item.productId,
        warehouseId: input.warehouseId,
        correlationId: input.returnId,
        localAvailable: stock.availableQty,
      });

      processed += 1;
    }

    return { skipped: false, processed };
  }

  async validateProductStock(input: { items: Array<{ product_id: string; qty: number }> }) {
    const requested = new Map<string, number>();
    for (const item of input.items) {
      const qty = Number(item.qty);
      const current = requested.get(item.product_id) || 0;
      requested.set(item.product_id, current + qty);
    }

    const productIds = Array.from(requested.keys());
    const [productRows, stockMap] = await Promise.all([
      this.productSnapshotRepository.findByProductIds(productIds),
      this.inventoryRepository.computeTotalsByProductIds(productIds),
    ]);
    const productMap = new Map(productRows.map((row) => [row.productId, row]));

    const results = productIds.map((productId) => {
      const requestedQty = requested.get(productId) || 0;
      const product = productMap.get(productId);
      const stock = stockMap.get(productId) || { available: 0, total: 0 };

      if (!product) {
        return {
          product_id: productId,
          qty: requestedQty,
          stock_validation: false,
          reason: 'PRODUCT_NOT_FOUND' as const,
        };
      }

      const unitPrice = Number(product.price.toString());
      const productPayload = {
        product_id: product.productId,
        slug: product.slug,
        title: product.title,
        description: product.description,
        sku: product.sku,
        price: unitPrice,
        stock: stock.total,
        reserved_stock: 0,
        available_stock: stock.available,
        currency: product.currency,
        category_id: product.categoryId,
        parent_category_id: product.parentCategoryId,
        parent_category_name: product.parentCategoryName,
        parent_category_slug: product.parentCategorySlug,
        shop_id: product.shopId,
        images: product.images,
        image_url: product.imageUrl,
        is_active: product.isActive,
      };

      if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        return {
          product_id: productId,
          qty: requestedQty,
          stock_validation: false,
          reason: 'INVALID_QTY' as const,
          available_stock: stock.available,
          product: productPayload,
        };
      }

      if (!product.isActive) {
        return {
          product_id: productId,
          qty: requestedQty,
          stock_validation: false,
          reason: 'PRODUCT_INACTIVE' as const,
          available_stock: stock.available,
          product: productPayload,
        };
      }

      if (stock.available < requestedQty) {
        return {
          product_id: productId,
          qty: requestedQty,
          stock_validation: false,
          reason: 'OUT_OF_STOCK' as const,
          available_stock: stock.available,
          unit_price: unitPrice,
          line_total: Number((unitPrice * requestedQty).toFixed(2)),
          product: productPayload,
        };
      }

      return {
        product_id: productId,
        qty: requestedQty,
        stock_validation: true,
        reason: 'OK' as const,
        available_stock: stock.available,
        unit_price: unitPrice,
        line_total: Number((unitPrice * requestedQty).toFixed(2)),
        product: productPayload,
      };
    });

    return {
      stock_validation: results.every((item) => item.stock_validation),
      items: results,
    };
  }

  private async resolveShopId(tx: Prisma.TransactionClient, productId: string) {
    const snapshots = await this.productSnapshotRepository.findByProductIds([productId], tx);
    return snapshots[0]?.shopId;
  }

  private async publishStockChange(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      warehouseId: string;
      correlationId: string;
      localAvailable: number;
    }
  ): Promise<string | null> {
    const shopId = await this.resolveShopId(tx, params.productId);
    if (!shopId) return null;

    const totals = await this.inventoryRepository.computeTotalsByProductId(params.productId, tx);
    await this.eventsPublisher.publishInventoryUpdated({
      productId: params.productId,
      shopId,
      totalStock: totals.total,
      availableStock: totals.available,
      correlationId: params.correlationId,
      db: tx,
    });
    await this.maybePublishLowStock({
      warehouseId: params.warehouseId,
      productId: params.productId,
      shopId,
      availableStock: params.localAvailable,
      correlationId: params.correlationId,
      db: tx,
    });
    return shopId;
  }

  private async applyDelta(
    tx: Prisma.TransactionClient,
    params: {
      warehouseId: string;
      productId: string;
      variantId?: string;
      delta: number;
      minAvailable?: number;
      errorMessage?: string;
    }
  ): Promise<{ beforeQty: number; afterQty: number; stock: InventoryStock }> {
    const variantId = params.variantId ?? '';
    await this.inventoryRepository.ensureRow(
      params.warehouseId,
      params.productId,
      variantId,
      tx
    );
    const locked = await this.inventoryRepository.lockByKey(
      params.warehouseId,
      params.productId,
      variantId,
      tx
    );

    const beforeQty = locked.onHandQty;
    const beforeAvailable = locked.onHandQty - locked.reservedQty;
    if (params.minAvailable !== undefined && beforeAvailable < params.minAvailable) {
      throw new ValidationError(
        params.errorMessage ?? 'Insufficient available stock in source warehouse'
      );
    }

    const afterQty = beforeQty + params.delta;
    if (afterQty < 0) throw new ValidationError('Cannot reduce stock below zero');

    const stock = await this.inventoryRepository.setQuantities(
      locked.id,
      {
        onHandQty: afterQty,
        reservedQty: locked.reservedQty,
        availableQty: afterQty - locked.reservedQty,
      },
      tx
    );

    return { beforeQty, afterQty, stock };
  }
}
