import prisma from '@/config/database';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { MovementRepository } from '@/repositories/movement.repository';
import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { EventsPublisher } from '@/publishers/events.publisher';

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
  private readonly eventsPublisher = new EventsPublisher();

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

      return updated;
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
      const stock = stockMap.get(productId) || { available: 0, reserved: 0, total: 0 };

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
        reserved_stock: stock.reserved,
        available_stock: stock.available,
        currency: product.currency,
        category_id: product.categoryId,
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
