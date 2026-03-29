import type { Prisma } from '@prisma/client';
import prisma from '@/config/database';
import env from '@/config/env';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { MovementRepository } from '@/repositories/movement.repository';
import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { WarehouseService } from '@/services/warehouse.service';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { EventsPublisher } from '@/publishers/events.publisher';

type Db = Prisma.TransactionClient | typeof prisma;

export const toAvailabilityStatus = (availableStock: number) => {
  if (availableStock <= 0) return 'OUT_OF_STOCK';
  if (availableStock <= 5) return 'LOW_STOCK';
  return 'IN_STOCK';
};

export class InventoryService {
  private readonly inventoryRepository = new InventoryRepository();
  private readonly movementRepository = new MovementRepository();
  private readonly productSnapshotRepository = new ProductSnapshotRepository();
  private readonly warehouseRepository = new WarehouseRepository();
  private readonly warehouseService = new WarehouseService();
  private readonly eventsPublisher = new EventsPublisher();
  private readonly threshold = env.LOW_STOCK_THRESHOLD;

  /**
   * Ensures inventory rows exist for this product across the shop's warehouses (starting at 0).
   * Called when catalog events create/update a product snapshot.
   */
  async ensureInventoryRowsForProduct(input: { productId: string; shopId: string }) {
    let warehouses = await this.warehouseRepository.findActiveByShop(input.shopId);
    if (warehouses.length === 0) {
      await this.warehouseService.ensureDefaultWarehouse(input.shopId);
      warehouses = await this.warehouseRepository.findActiveByShop(input.shopId);
    }
    await prisma.$transaction(async (tx) => {
      for (const warehouse of warehouses) {
        await this.inventoryRepository.upsertByWarehouseAndProduct(
          warehouse.id,
          input.productId,
          tx
        );
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
    return this.inventoryRepository.listByWarehouse(warehouseId);
  }

  async increaseStock(input: {
    warehouseId: string;
    productId: string;
    quantity: number;
    referenceId: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');

    return prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('Warehouse not found');

      await this.inventoryRepository.upsertByWarehouseAndProduct(
        input.warehouseId,
        input.productId,
        tx
      );

      const inventory = await this.inventoryRepository.incrementStocks({
        warehouseId: input.warehouseId,
        productId: input.productId,
        availableDelta: input.quantity,
        db: tx,
      });

      await this.movementRepository.create({
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'INBOUND',
        quantity: input.quantity,
        referenceId: input.referenceId,
        referenceType: 'MANUAL',
        correlationId: input.referenceId,
        db: tx,
      });

      const totals = await this.inventoryRepository.computeTotalStockByShopProduct(
        warehouse.shopId,
        input.productId,
        tx
      );
      await this.eventsPublisher.publishInventoryUpdated({
        productId: input.productId,
        shopId: warehouse.shopId,
        totalStock: totals.total,
        availableStock: totals.available,
        correlationId: input.referenceId,
        db: tx,
      });
      await this.maybePublishLowStock({
        warehouseId: input.warehouseId,
        productId: input.productId,
        shopId: warehouse.shopId,
        availableStock: inventory.availableStock,
        correlationId: input.referenceId,
        db: tx,
      });

      return inventory;
    });
  }

  async adjustStock(input: {
    warehouseId: string;
    productId: string;
    quantity: number;
    referenceId: string;
  }) {
    if (input.quantity === 0) throw new ValidationError('Quantity cannot be 0');

    return prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('Warehouse not found');

      const existing = await this.inventoryRepository.findByWarehouseAndProduct(
        input.warehouseId,
        input.productId,
        tx
      );
      if (!existing) {
        throw new NotFoundError('Inventory row not found');
      }

      const nextAvailable = existing.availableStock + input.quantity;
      if (nextAvailable < 0) throw new ValidationError('Cannot reduce stock below zero');

      const updated = await this.inventoryRepository.incrementStocks({
        warehouseId: input.warehouseId,
        productId: input.productId,
        availableDelta: input.quantity,
        db: tx,
      });

      await this.movementRepository.create({
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'ADJUSTMENT',
        quantity: input.quantity,
        referenceId: input.referenceId,
        referenceType: 'MANUAL',
        correlationId: input.referenceId,
        db: tx,
      });

      const totals = await this.inventoryRepository.computeTotalStockByShopProduct(
        warehouse.shopId,
        input.productId,
        tx
      );
      await this.eventsPublisher.publishInventoryUpdated({
        productId: input.productId,
        shopId: warehouse.shopId,
        totalStock: totals.total,
        availableStock: totals.available,
        correlationId: input.referenceId,
        db: tx,
      });
      await this.maybePublishLowStock({
        warehouseId: input.warehouseId,
        productId: input.productId,
        shopId: warehouse.shopId,
        availableStock: updated.availableStock,
        correlationId: input.referenceId,
        db: tx,
      });

      return updated;
    });
  }

  async transferStock(input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    productId: string;
    quantity: number;
    referenceId: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new ValidationError('Source and destination warehouses must be different');
    }

    return prisma.$transaction(async (tx) => {
      const [fromWarehouse, toWarehouse] = await Promise.all([
        this.warehouseRepository.findById(input.fromWarehouseId, tx),
        this.warehouseRepository.findById(input.toWarehouseId, tx),
      ]);
      if (!fromWarehouse) throw new NotFoundError('Source warehouse not found');
      if (!toWarehouse) throw new NotFoundError('Destination warehouse not found');

      const fromInventory = await this.inventoryRepository.findByWarehouseAndProduct(
        input.fromWarehouseId,
        input.productId,
        tx
      );
      if (!fromInventory) throw new NotFoundError('Inventory not found in source warehouse');
      if (fromInventory.availableStock < input.quantity) {
        throw new ValidationError('Insufficient available stock in source warehouse');
      }

      await this.inventoryRepository.upsertByWarehouseAndProduct(
        input.toWarehouseId,
        input.productId,
        tx
      );

      const fromUpdated = await this.inventoryRepository.incrementStocks({
        warehouseId: input.fromWarehouseId,
        productId: input.productId,
        availableDelta: -input.quantity,
        db: tx,
      });

      const toUpdated = await this.inventoryRepository.incrementStocks({
        warehouseId: input.toWarehouseId,
        productId: input.productId,
        availableDelta: input.quantity,
        db: tx,
      });

      await this.movementRepository.create({
        productId: input.productId,
        warehouseId: input.fromWarehouseId,
        type: 'OUTBOUND',
        quantity: input.quantity,
        referenceId: input.referenceId,
        referenceType: 'TRANSFER',
        correlationId: input.referenceId,
        db: tx,
      });

      await this.movementRepository.create({
        productId: input.productId,
        warehouseId: input.toWarehouseId,
        type: 'INBOUND',
        quantity: input.quantity,
        referenceId: input.referenceId,
        referenceType: 'TRANSFER',
        correlationId: input.referenceId,
        db: tx,
      });

      const totals = await this.inventoryRepository.computeTotalStockByShopProduct(
        fromWarehouse.shopId,
        input.productId,
        tx
      );
      await this.eventsPublisher.publishInventoryUpdated({
        productId: input.productId,
        shopId: fromWarehouse.shopId,
        totalStock: totals.total,
        availableStock: totals.available,
        correlationId: input.referenceId,
        db: tx,
      });

      await this.maybePublishLowStock({
        warehouseId: input.fromWarehouseId,
        productId: input.productId,
        shopId: fromWarehouse.shopId,
        availableStock: fromUpdated.availableStock,
        correlationId: input.referenceId,
        db: tx,
      });

      if (toWarehouse.shopId !== fromWarehouse.shopId) {
        const toTotals = await this.inventoryRepository.computeTotalStockByShopProduct(
          toWarehouse.shopId,
          input.productId,
          tx
        );
        await this.eventsPublisher.publishInventoryUpdated({
          productId: input.productId,
          shopId: toWarehouse.shopId,
          totalStock: toTotals.total,
          availableStock: toTotals.available,
          correlationId: input.referenceId,
          db: tx,
        });
      }

      await this.maybePublishLowStock({
        warehouseId: input.toWarehouseId,
        productId: input.productId,
        shopId: toWarehouse.shopId,
        availableStock: toUpdated.availableStock,
        correlationId: input.referenceId,
        db: tx,
      });

      return { fromWarehouse: fromUpdated, toWarehouse: toUpdated };
    });
  }

  async countStock(input: {
    warehouseId: string;
    productId: string;
    countedQty: number;
    referenceId: string;
  }) {
    if (input.countedQty < 0) throw new ValidationError('Counted quantity cannot be negative');

    return prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('Warehouse not found');

      const existing = await this.inventoryRepository.findByWarehouseAndProduct(
        input.warehouseId,
        input.productId,
        tx
      );
      if (!existing) throw new NotFoundError('Inventory not found');

      const delta = input.countedQty - existing.availableStock;
      if (delta === 0) return existing;

      const updated = await this.inventoryRepository.incrementStocks({
        warehouseId: input.warehouseId,
        productId: input.productId,
        availableDelta: delta,
        db: tx,
      });

      await this.movementRepository.create({
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'ADJUSTMENT',
        quantity: delta,
        referenceId: input.referenceId,
        referenceType: 'STOCK_TAKE',
        correlationId: input.referenceId,
        metadata: { countedQty: input.countedQty, previousStock: existing.availableStock },
        db: tx,
      });

      const totals = await this.inventoryRepository.computeTotalStockByShopProduct(
        warehouse.shopId,
        input.productId,
        tx
      );
      await this.eventsPublisher.publishInventoryUpdated({
        productId: input.productId,
        shopId: warehouse.shopId,
        totalStock: totals.total,
        availableStock: totals.available,
        correlationId: input.referenceId,
        db: tx,
      });
      await this.maybePublishLowStock({
        warehouseId: input.warehouseId,
        productId: input.productId,
        shopId: warehouse.shopId,
        availableStock: updated.availableStock,
        correlationId: input.referenceId,
        db: tx,
      });

      return updated;
    });
  }

  async receiveStock(input: {
    warehouseId: string;
    productId: string;
    quantity: number;
    referenceType: 'PO' | string;
    referenceId: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');

    return prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseRepository.findById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('Warehouse not found');

      await this.inventoryRepository.upsertByWarehouseAndProduct(
        input.warehouseId,
        input.productId,
        tx
      );

      const inventory = await this.inventoryRepository.incrementStocks({
        warehouseId: input.warehouseId,
        productId: input.productId,
        availableDelta: input.quantity,
        db: tx,
      });

      const refType = input.referenceType === 'PO' ? 'PO' : 'MANUAL';
      await this.movementRepository.create({
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'INBOUND',
        quantity: input.quantity,
        referenceId: input.referenceId,
        referenceType: refType,
        correlationId: input.referenceId,
        metadata: refType === 'PO' ? { referenceType: input.referenceType } : undefined,
        db: tx,
      });

      const totals = await this.inventoryRepository.computeTotalStockByShopProduct(
        warehouse.shopId,
        input.productId,
        tx
      );
      await this.eventsPublisher.publishInventoryUpdated({
        productId: input.productId,
        shopId: warehouse.shopId,
        totalStock: totals.total,
        availableStock: totals.available,
        correlationId: input.referenceId,
        db: tx,
      });
      await this.maybePublishLowStock({
        warehouseId: input.warehouseId,
        productId: input.productId,
        shopId: warehouse.shopId,
        availableStock: inventory.availableStock,
        correlationId: input.referenceId,
        db: tx,
      });

      return inventory;
    });
  }

  async listMovements(input: { productId?: string; warehouseId?: string; limit?: number }) {
    return this.movementRepository.list(input);
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
}
