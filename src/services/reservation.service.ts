import prisma from '@/config/database';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { MovementRepository } from '@/repositories/movement.repository';
import { ReservationRepository } from '@/repositories/reservation.repository';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { ConflictError, NotFoundError, ValidationError } from '@/utils/errors';
import { EventsPublisher } from '@/publishers/events.publisher';

type OrderCreatedItem = {
  productId: string;
  quantity: number;
  shopId: string;
};

export class ReservationService {
  private readonly reservationRepository = new ReservationRepository();
  private readonly inventoryRepository = new InventoryRepository();
  private readonly warehouseRepository = new WarehouseRepository();
  private readonly movementRepository = new MovementRepository();
  private readonly eventsPublisher = new EventsPublisher();

  async createInventoryForProduct(input: { productId: string; shopId: string; initialStock?: number }) {
    const initialStock =
      Number.isFinite(input.initialStock) && Number(input.initialStock) > 0
        ? Math.trunc(Number(input.initialStock))
        : 0;
    const warehouses = await this.warehouseRepository.findActiveByShop(input.shopId);
    if (warehouses.length === 0) {
      await this.warehouseRepository.create({
        shopId: input.shopId,
        name: `Default Warehouse (${input.shopId.slice(0, 8)})`,
      });
    }
    const finalWarehouses = await this.warehouseRepository.findActiveByShop(input.shopId);
    await prisma.$transaction(async (tx) => {
      for (const warehouse of finalWarehouses) {
        await this.inventoryRepository.upsertByWarehouseAndProduct(
          warehouse.id,
          input.productId,
          tx
        );
      }

      // Seed initial stock only once to avoid over-counting on duplicate product.created events.
      if (initialStock > 0 && finalWarehouses.length > 0) {
        const currentTotals = await this.inventoryRepository.computeTotalStockByShopProduct(
          input.shopId,
          input.productId,
          tx
        );
        if (currentTotals.total === 0) {
          const primaryWarehouse = finalWarehouses[0];
          await this.inventoryRepository.incrementStocks({
            warehouseId: primaryWarehouse.id,
            productId: input.productId,
            availableDelta: initialStock,
            db: tx,
          });
          await this.movementRepository.create({
            productId: input.productId,
            warehouseId: primaryWarehouse.id,
            type: 'INBOUND',
            quantity: initialStock,
            referenceId: `bootstrap:product.created:${input.productId}`,
            db: tx,
          });

          const totals = await this.inventoryRepository.computeTotalStockByShopProduct(
            input.shopId,
            input.productId,
            tx
          );
          await this.eventsPublisher.publishInventoryUpdated({
            productId: input.productId,
            shopId: input.shopId,
            totalStock: totals.total,
            availableStock: totals.available,
            correlationId: `bootstrap:${input.productId}`,
            db: tx,
          });
        }
      }
    });
  }

  async reserveStock(input: {
    checkoutId: string;
    orderId?: string;
    expiresAt: string;
    items: OrderCreatedItem[];
    correlationId: string;
  }) {
    if (input.items.length === 0) {
      throw new ValidationError('Order items are required');
    }
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new ValidationError('Invalid reservation expiry timestamp');
    }

    return prisma.$transaction(async (tx) => {
      const existing = await this.reservationRepository.findByCheckoutId(input.checkoutId, tx);
      if (existing) {
        return existing;
      }

      const selected: Array<{ productId: string; warehouseId: string; quantity: number; shopId: string }> = [];

      for (const item of input.items) {
        const candidates = await this.inventoryRepository.lockCandidatesForReservation({
          productId: item.productId,
          shopId: item.shopId,
          db: tx,
        });

        if (candidates.length === 0) {
          throw new NotFoundError(`PRODUCT_NOT_FOUND:${item.productId}`);
        }

        const candidate = candidates.find((row) => row.availableStock >= item.quantity);
        if (!candidate) {
          throw new ConflictError(`OUT_OF_STOCK:${item.productId}`);
        }

        await this.inventoryRepository.incrementStocks({
          warehouseId: candidate.warehouseId,
          productId: item.productId,
          availableDelta: -item.quantity,
          reservedDelta: item.quantity,
          db: tx,
        });

        await this.movementRepository.create({
          productId: item.productId,
          warehouseId: candidate.warehouseId,
          type: 'RESERVED',
          quantity: item.quantity,
          referenceId: input.checkoutId,
          db: tx,
        });

        selected.push({
          productId: item.productId,
          warehouseId: candidate.warehouseId,
          quantity: item.quantity,
          shopId: item.shopId,
        });
      }

      const reservation = await this.reservationRepository.createWithItems({
        orderId: input.orderId ?? input.checkoutId,
        checkoutId: input.checkoutId,
        expiresAt,
        items: selected.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId,
          quantity: item.quantity,
        })),
        db: tx,
      });

      await this.eventsPublisher.publishStockReserved({
        checkoutId: input.checkoutId,
        reservationId: reservation.id,
        correlationId: input.correlationId,
        db: tx,
      });

      for (const item of selected) {
        const total = await this.inventoryRepository.computeTotalStockByShopProduct(
          item.shopId,
          item.productId,
          tx
        );
        await this.eventsPublisher.publishInventoryUpdated({
          productId: item.productId,
          shopId: item.shopId,
          totalStock: total.total,
          availableStock: total.available,
          correlationId: input.correlationId,
          db: tx,
        });
      }

      return reservation;
    });
  }

  async confirmReservation(input: {
    checkoutId: string;
    reservationId?: string;
    correlationId: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const reservation = input.reservationId
        ? await this.reservationRepository.findById(input.reservationId, tx)
        : await this.reservationRepository.findByCheckoutId(input.checkoutId, tx);
      if (!reservation) throw new NotFoundError('Reservation not found');

      if (reservation.status === 'CONFIRMED') return reservation;
      if (reservation.expiresAt < new Date()) {
        throw new ConflictError('Reservation expired');
      }
      if (reservation.status !== 'RESERVED') {
        throw new ConflictError(`Reservation status is ${reservation.status}`);
      }

      for (const item of reservation.items) {
        const inventory = await this.inventoryRepository.findByWarehouseAndProduct(
          item.warehouseId,
          item.productId,
          tx
        );
        if (!inventory || inventory.reservedStock < item.quantity) {
          throw new ConflictError('Reserved stock mismatch');
        }

        await this.inventoryRepository.incrementStocks({
          warehouseId: item.warehouseId,
          productId: item.productId,
          reservedDelta: -item.quantity,
          db: tx,
        });

        await this.movementRepository.create({
          productId: item.productId,
          warehouseId: item.warehouseId,
          type: 'OUTBOUND',
          quantity: item.quantity,
          referenceId: reservation.id,
          db: tx,
        });
      }

      await this.reservationRepository.updateStatus(reservation.id, 'CONFIRMED', tx);

      await this.eventsPublisher.publishStockConfirmed({
        checkoutId: reservation.checkoutId,
        reservationId: reservation.id,
        correlationId: input.correlationId,
        db: tx,
      });

      for (const item of reservation.items) {
        const warehouse = await this.warehouseRepository.findById(item.warehouseId, tx);
        if (!warehouse) continue;
        const total = await this.inventoryRepository.computeTotalStockByShopProduct(
          warehouse.shopId,
          item.productId,
          tx
        );
        await this.eventsPublisher.publishInventoryUpdated({
          productId: item.productId,
          shopId: warehouse.shopId,
          totalStock: total.total,
          availableStock: total.available,
          correlationId: input.correlationId,
          db: tx,
        });
      }

      return reservation;
    });
  }

  async releaseReservation(input: {
    checkoutId: string;
    reservationId?: string;
    correlationId: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const reservation = input.reservationId
        ? await this.reservationRepository.findById(input.reservationId, tx)
        : await this.reservationRepository.findByCheckoutId(input.checkoutId, tx);
      if (!reservation) return null;

      if (reservation.status === 'RELEASED') return reservation;
      if (reservation.status === 'EXPIRED') return reservation;
      if (reservation.status !== 'RESERVED') return reservation;

      for (const item of reservation.items) {
        await this.inventoryRepository.incrementStocks({
          warehouseId: item.warehouseId,
          productId: item.productId,
          availableDelta: item.quantity,
          reservedDelta: -item.quantity,
          db: tx,
        });

        await this.movementRepository.create({
          productId: item.productId,
          warehouseId: item.warehouseId,
          type: 'RELEASED',
          quantity: item.quantity,
          referenceId: reservation.id,
          db: tx,
        });
      }

      await this.reservationRepository.updateStatus(reservation.id, 'RELEASED', tx);

      for (const item of reservation.items) {
        const warehouse = await this.warehouseRepository.findById(item.warehouseId, tx);
        if (!warehouse) continue;
        const total = await this.inventoryRepository.computeTotalStockByShopProduct(
          warehouse.shopId,
          item.productId,
          tx
        );
        await this.eventsPublisher.publishInventoryUpdated({
          productId: item.productId,
          shopId: warehouse.shopId,
          totalStock: total.total,
          availableStock: total.available,
          correlationId: input.correlationId,
          db: tx,
        });
      }

      return reservation;
    });
  }

  async expireReservations(now = new Date()) {
    const expiredIds = await this.reservationRepository.findExpiredReservedIds(now);
    let expiredCount = 0;

    for (const reservationId of expiredIds) {
      const expired = await prisma.$transaction(async (tx) => {
        const reservation = await this.reservationRepository.findById(reservationId, tx);
        if (!reservation || reservation.status !== 'RESERVED' || reservation.expiresAt >= now) {
          return false;
        }

        for (const item of reservation.items) {
          await this.inventoryRepository.incrementStocks({
            warehouseId: item.warehouseId,
            productId: item.productId,
            availableDelta: item.quantity,
            reservedDelta: -item.quantity,
            db: tx,
          });

          await this.movementRepository.create({
            productId: item.productId,
            warehouseId: item.warehouseId,
            type: 'RELEASED',
            quantity: item.quantity,
            referenceId: reservation.id,
            db: tx,
          });
        }

        await this.reservationRepository.updateStatus(reservation.id, 'EXPIRED', tx);

        for (const item of reservation.items) {
          const warehouse = await this.warehouseRepository.findById(item.warehouseId, tx);
          if (!warehouse) continue;
          const total = await this.inventoryRepository.computeTotalStockByShopProduct(
            warehouse.shopId,
            item.productId,
            tx
          );
          await this.eventsPublisher.publishInventoryUpdated({
            productId: item.productId,
            shopId: warehouse.shopId,
            totalStock: total.total,
            availableStock: total.available,
            correlationId: reservation.checkoutId,
            db: tx,
          });
        }

        return true;
      });

      if (expired) expiredCount += 1;
    }

    return expiredCount;
  }

  async cleanupExpiredReservations(cutoff: Date) {
    return this.reservationRepository.deleteExpired(cutoff);
  }
}
