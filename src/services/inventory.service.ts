import type { InventoryStock, MovementType, Prisma, TransferStatus } from '@prisma/client';
import prisma from '@/config/database';
import env from '@/config/env';
import { InventoryRepository } from '@/repositories/inventory.repository';
import { MovementRepository } from '@/repositories/movement.repository';
import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { TransferRepository } from '@/repositories/transfer.repository';
import { WarehouseRepository } from '@/repositories/warehouse.repository';
import { EventsPublisher } from '@/publishers/events.publisher';
import { AppError, NotFoundError, ValidationError } from '@/utils/errors';

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

/** all: admin and service calls. owner: warehouse manager. seller: shop user. */
export type StockViewer =
  | { kind: 'all' }
  | { kind: 'owner'; userId: string }
  | { kind: 'seller'; userId: string; userIds?: string[] };

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

  /** Posted receipts for purchase orders this seller created. */
  async purchasedLines(userId: string | string[]): Promise<Array<{ warehouseId: string; productId: string }>> {
    const ids = [...new Set((Array.isArray(userId) ? userId : [userId]).map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    const receipts = await prisma.purchaseReceipt.findMany({
      where: {
        status: 'POSTED',
        purchaseOrder: { createdBy: { in: ids } },
      },
      select: {
        warehouseId: true,
        items: { select: { productId: true, acceptedQty: true, quantity: true } },
      },
    });
    const seen = new Set<string>();
    const lines: Array<{ warehouseId: string; productId: string }> = [];
    for (const receipt of receipts) {
      for (const item of receipt.items) {
        const qty = item.acceptedQty ?? item.quantity;
        if (qty <= 0) continue;
        const key = `${receipt.warehouseId}:${item.productId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({ warehouseId: receipt.warehouseId, productId: item.productId });
      }
    }
    return lines;
  }

  async purchasedWarehouseIds(userId: string | string[]): Promise<string[]> {
    const lines = await this.purchasedLines(userId);
    return [...new Set(lines.map((line) => line.warehouseId))];
  }

  private async warehouseIdsForUsers(userIds: string[]): Promise<string[]> {
    const lists = await Promise.all(
      userIds.filter(Boolean).map((userId) => this.warehouseRepository.listIdsByCreatedBy(userId)),
    );
    return [...new Set(lists.flat())];
  }

  private sellerIdentity(viewer: StockViewer): string[] {
    if (viewer.kind !== 'seller') return [];
    return [...new Set([viewer.userId, ...(viewer.userIds ?? [])].map((id) => id.trim()).filter(Boolean))];
  }

  async listWarehouseInventory(warehouseId: string, viewer: StockViewer = { kind: 'all' }) {
    const warehouse = await this.warehouseRepository.findById(warehouseId);
    if (!warehouse) throw new NotFoundError('Warehouse not found');
    const stocks = await this.inventoryRepository.listByWarehouse(warehouseId);

    if (viewer.kind === 'all') return stocks.map(withAvailability);

    if (viewer.kind === 'owner') {
      if (warehouse.createdBy !== viewer.userId) throw new NotFoundError('Warehouse not found');
      return stocks.map(withAvailability);
    }

    const sellerIds = this.sellerIdentity(viewer);
    if (warehouse.createdBy && sellerIds.includes(warehouse.createdBy)) {
      return stocks.map(withAvailability);
    }

    const lines = await this.purchasedLines(sellerIds);
    const productIds = new Set(
      lines.filter((line) => line.warehouseId === warehouseId).map((line) => line.productId),
    );
    if (productIds.size === 0) throw new NotFoundError('Warehouse not found');
    return stocks.filter((stock) => productIds.has(stock.productId)).map(withAvailability);
  }

  async listMovements(
    input: {
      productId?: string;
      warehouseId?: string;
      movementType?: MovementType;
      limit?: number;
    },
    viewer: StockViewer = { kind: 'all' },
  ) {
    if (viewer.kind === 'all') return this.movementRepository.list(input);
    if (viewer.kind === 'owner') {
      const warehouseIds = await this.warehouseRepository.listIdsByCreatedBy(viewer.userId);
      if (input.warehouseId && !warehouseIds.includes(input.warehouseId)) return [];
      return this.movementRepository.list({
        ...input,
        warehouseIds: input.warehouseId ? undefined : warehouseIds,
      });
    }
    const sellerIds = this.sellerIdentity(viewer);
    const [ownedIds, lines] = await Promise.all([
      this.warehouseIdsForUsers(sellerIds),
      this.purchasedLines(sellerIds),
    ]);
    return this.movementRepository.list({
      ...input,
      or: [
        ...ownedIds.map((warehouseId) => ({ warehouseId })),
        ...lines.map((line) => ({ warehouseId: line.warehouseId, productId: line.productId })),
      ],
    });
  }

  async listTransfers(
    input: {
      warehouseId?: string;
      status?: TransferStatus;
      limit?: number;
    },
    viewer: StockViewer = { kind: 'all' },
  ) {
    if (viewer.kind === 'all') return this.transferRepository.list(input);
    if (viewer.kind === 'owner') {
      const ids = await this.warehouseRepository.listIdsByCreatedBy(viewer.userId);
      if (input.status === 'PENDING') {
        return this.transferRepository.list({ ...input, managerPendingIds: ids });
      }
      return this.transferRepository.list({ ...input, touchingWarehouseIds: ids });
    }
    const sellerIds = this.sellerIdentity(viewer);
    if (input.status === 'PENDING') {
      return this.transferRepository.list({ ...input, approvalSellerUserIds: sellerIds });
    }
    const owned = await this.warehouseIdsForUsers(sellerIds);
    return this.transferRepository.list({
      ...input,
      sellerUserIds: sellerIds,
      sellerWarehouseIds: owned,
    });
  }

  async assertCanRequestTransfer(
    input: { fromWarehouseId: string; productId: string },
    viewer: StockViewer,
  ) {
    if (viewer.kind === 'all') return;
    const warehouse = await this.warehouseRepository.findById(input.fromWarehouseId);
    if (!warehouse) throw new NotFoundError('Source warehouse not found');
    if (viewer.kind === 'owner') {
      if (warehouse.createdBy !== viewer.userId) {
        throw new AppError('You can only transfer stock from your own warehouse', 403, 'FORBIDDEN');
      }
      return;
    }
    const sellerIds = this.sellerIdentity(viewer);
    if (warehouse.sellerUserId && sellerIds.includes(warehouse.sellerUserId)) return;
    if (warehouse.createdBy && sellerIds.includes(warehouse.createdBy)) return;
    const lines = await this.purchasedLines(sellerIds);
    const allowed = lines.some(
      (line) => line.warehouseId === input.fromWarehouseId && line.productId === input.productId,
    );
    if (!allowed) {
      throw new AppError('You can only transfer products from your purchases', 403, 'FORBIDDEN');
    }
  }

  async assertCanDecideTransfer(transferId: string, viewer: StockViewer) {
    if (viewer.kind === 'all') return;
    const transfer = await this.transferRepository.findById(transferId);
    if (!transfer) throw new NotFoundError('Transfer not found');

    if (transfer.approvalSellerUserId && !transfer.fromSellerUserId && transfer.status === 'PENDING') {
      const sellerIds = viewer.kind === 'seller' ? this.sellerIdentity(viewer) : [];
      if (!sellerIds.includes(transfer.approvalSellerUserId)) {
        throw new AppError('Only the seller can approve or reject this transfer request', 403, 'FORBIDDEN');
      }
      return;
    }

    if (transfer.status === 'SELLER_APPROVED') {
      if (viewer.kind !== 'owner') {
        throw new AppError('Only the warehouse manager can complete this transfer', 403, 'FORBIDDEN');
      }
      const warehouse = await this.warehouseRepository.findById(transfer.fromWarehouseId ?? '');
      if (!warehouse || warehouse.createdBy !== viewer.userId) {
        throw new AppError('Only the source warehouse manager can complete this transfer', 403, 'FORBIDDEN');
      }
      return;
    }

    if (viewer.kind !== 'owner') {
      throw new AppError(
        'Only the destination warehouse manager can approve or reject this transfer',
        403,
        'FORBIDDEN',
      );
    }
    if (transfer.fromSellerUserId) {
      const destination = await this.warehouseRepository.findById(transfer.toWarehouseId);
      if (!destination || destination.createdBy !== viewer.userId) {
        throw new AppError(
          'Only the destination warehouse manager can approve or reject this transfer',
          403,
          'FORBIDDEN',
        );
      }
      return;
    }
    throw new AppError('This transfer is waiting for the seller', 403, 'FORBIDDEN');
  }

  async availableQty(
    warehouseId: string,
    productId: string,
    db?: Prisma.TransactionClient,
  ): Promise<number> {
    const rows = await this.inventoryRepository.listByProductInWarehouse(warehouseId, productId, db);
    return rows.reduce((sum, row) => sum + this.movableQty(row), 0);
  }

  /** Takes stock already in the warehouse for a seller warehouse order. */
  async issueSale(
    tx: Prisma.TransactionClient,
    input: {
      warehouseId: string;
      productId: string;
      quantity: number;
      referenceId: string;
      createdBy?: string | null;
    },
  ) {
    const rows = await this.inventoryRepository.listByProductInWarehouse(
      input.warehouseId,
      input.productId,
      tx,
    );
    const ranked = [...rows].sort((a, b) => this.movableQty(b) - this.movableQty(a));
    let remaining = input.quantity;

    for (const row of ranked) {
      if (remaining <= 0) break;
      const movable = this.movableQty(row);
      if (movable <= 0) continue;
      const take = Math.min(movable, remaining);
      const moved = await this.applyDelta(tx, {
        warehouseId: input.warehouseId,
        productId: input.productId,
        variantId: row.variantId,
        delta: -take,
        minAvailable: take,
        errorMessage: 'Not enough stock',
      });
      await this.movementRepository.create({
        warehouseId: input.warehouseId,
        productId: input.productId,
        variantId: row.variantId,
        movementType: 'SALE_ISSUED',
        quantity: moved.afterQty - moved.beforeQty,
        beforeQty: moved.beforeQty,
        afterQty: moved.afterQty,
        referenceType: 'PURCHASE_ORDER',
        referenceId: input.referenceId,
        createdBy: input.createdBy ?? null,
        db: tx,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new ValidationError('Not enough stock');
    }
  }

  async listSellerStock(userId: string) {
    if (!userId) return [];
    return prisma.sellerStock.findMany({
      where: { userId, availableQty: { gt: 0 } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async creditSellerStock(
    tx: Prisma.TransactionClient,
    input: { userId: string; productId: string; variantId?: string; quantity: number },
  ) {
    const variantId = input.variantId ?? '';
    const existing = await tx.sellerStock.findUnique({
      where: { userId_productId_variantId: { userId: input.userId, productId: input.productId, variantId } },
    });
    if (!existing) {
      return tx.sellerStock.create({
        data: {
          userId: input.userId,
          productId: input.productId,
          variantId,
          onHandQty: input.quantity,
          availableQty: input.quantity,
        },
      });
    }
    return tx.sellerStock.update({
      where: { id: existing.id },
      data: {
        onHandQty: { increment: input.quantity },
        availableQty: { increment: input.quantity },
      },
    });
  }

  async debitSellerStock(
    tx: Prisma.TransactionClient,
    input: { userId: string; productId: string; variantId?: string; quantity: number },
  ) {
    const variantId = input.variantId ?? '';
    const existing = await tx.sellerStock.findUnique({
      where: { userId_productId_variantId: { userId: input.userId, productId: input.productId, variantId } },
    });
    const available = existing?.availableQty ?? 0;
    if (!existing || available < input.quantity) {
      throw new ValidationError(
        `Not enough stock in your inventory. Available ${available}, requested ${input.quantity}.`,
      );
    }
    return tx.sellerStock.update({
      where: { id: existing.id },
      data: {
        onHandQty: { decrement: input.quantity },
        availableQty: { decrement: input.quantity },
      },
    });
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
    requesterIds?: string[];
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

    const approvalSellerUserId = await this.sellerForWarehouseProduct(
      input.fromWarehouseId,
      input.productId,
    );
    const requesterIds = new Set(
      [input.requestedBy, ...(input.requesterIds ?? [])].filter((id): id is string => Boolean(id)),
    );
    const sellerRequested = requesterIds.has(approvalSellerUserId);

    return this.transferRepository.create({
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      productId: input.productId,
      variantId: input.variantId,
      quantity: input.quantity,
      referenceId: input.referenceId,
      referenceType: input.referenceType ?? 'TRANSFER',
      requestedBy: input.requestedBy,
      approvalSellerUserId,
      status: sellerRequested ? 'SELLER_APPROVED' : 'PENDING',
    });
  }

  private async sellerForWarehouseProduct(warehouseId: string, productId: string) {
    const warehouse = await this.warehouseRepository.findById(warehouseId);
    if (warehouse?.sellerUserId) return warehouse.sellerUserId;

    const orders = await prisma.purchaseOrder.findMany({
      where: {
        warehouseId,
        orderKind: 'SUPPLIER',
        createdBy: { not: null },
        items: { some: { productId } },
      },
      select: { createdBy: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const sellerId = orders.find((order) => order.createdBy)?.createdBy;
    if (!sellerId) {
      throw new ValidationError('No seller is linked to this product in the warehouse.');
    }
    return sellerId;
  }

  async requestSellerTransfer(input: {
    fromSellerUserId: string;
    toWarehouseId: string;
    productId: string;
    variantId?: string;
    quantity: number;
    referenceId: string;
    requestedBy?: string;
  }) {
    if (input.quantity <= 0) throw new ValidationError('Quantity must be > 0');
    const destination = await this.warehouseRepository.findById(input.toWarehouseId);
    if (!destination) throw new NotFoundError('Destination warehouse not found');
    const rows = await prisma.sellerStock.findMany({
      where: { userId: input.fromSellerUserId, productId: input.productId },
    });
    const available = rows.reduce((sum, row) => sum + row.availableQty, 0);
    if (available < input.quantity) {
      throw new ValidationError(
        `Not enough stock in your inventory. Available ${available}, requested ${input.quantity}.`,
      );
    }
    return this.transferRepository.create({
      fromSellerUserId: input.fromSellerUserId,
      toWarehouseId: input.toWarehouseId,
      productId: input.productId,
      variantId: input.variantId,
      quantity: input.quantity,
      referenceId: input.referenceId,
      referenceType: 'SELLER_TRANSFER',
      requestedBy: input.requestedBy ?? input.fromSellerUserId,
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
      if (transfer.status !== 'PENDING' && transfer.status !== 'SELLER_APPROVED') {
        throw new ValidationError(`Transfer is already ${transfer.status.toLowerCase()}`);
      }

      if (
        transfer.approvalSellerUserId &&
        !transfer.fromSellerUserId &&
        transfer.status === 'PENDING'
      ) {
        const updated = await this.transferRepository.decide(
          transfer.id,
          {
            decidedBy: input.decidedBy,
            note: input.note ?? 'Seller approved the transfer request.',
            status: 'SELLER_APPROVED',
          },
          tx,
        );
        return { transfer: updated, fromWarehouse: null, toWarehouse: null };
      }

      if (transfer.approvalSellerUserId && !transfer.fromSellerUserId && transfer.status !== 'SELLER_APPROVED') {
        throw new ValidationError('The seller must approve this transfer before it can be completed');
      }

      if (transfer.fromSellerUserId) {
        if (transfer.status !== 'PENDING') {
          throw new ValidationError(`Transfer is already ${transfer.status.toLowerCase()}`);
        }
        const updated = await this.transferRepository.decide(
          transfer.id,
          {
            decidedBy: input.decidedBy,
            note: input.note ?? 'Approved. Receive the products into the warehouse.',
            status: 'AWAITING_RECEIPT',
          },
          tx,
        );
        return { transfer: updated, fromWarehouse: null, toWarehouse: null };
      }

      if (!transfer.fromWarehouseId) throw new NotFoundError('Source warehouse not found');
      const [fromWarehouse, toWarehouse] = await Promise.all([
        this.warehouseRepository.findById(transfer.fromWarehouseId, tx),
        this.warehouseRepository.findById(transfer.toWarehouseId, tx),
      ]);
      if (!fromWarehouse) throw new NotFoundError('Source warehouse not found');
      if (!toWarehouse) throw new NotFoundError('Destination warehouse not found');

      const referenceId = transfer.referenceId ?? transfer.id;
      const plan = await this.planTransferDeductions(
        tx,
        { ...transfer, fromWarehouseId: transfer.fromWarehouseId },
        fromWarehouse.name,
      );

      let sourceStock: InventoryStock | null = null;

      for (const step of plan) {
        const source = await this.applyDelta(tx, {
          warehouseId: transfer.fromWarehouseId,
          productId: transfer.productId,
          variantId: step.variantId,
          delta: -step.quantity,
          minAvailable: step.quantity,
          errorMessage: 'Not enough stock',
        });
        sourceStock = source.stock;

        await this.movementRepository.create({
          warehouseId: transfer.fromWarehouseId,
          productId: transfer.productId,
          variantId: step.variantId,
          movementType: 'TRANSFER_OUT',
          quantity: source.afterQty - source.beforeQty,
          beforeQty: source.beforeQty,
          afterQty: source.afterQty,
          referenceType: transfer.referenceType ?? 'TRANSFER',
          referenceId,
          createdBy: input.decidedBy ?? transfer.requestedBy,
          db: tx,
        });
      }

      await this.publishStockChange(tx, {
        productId: transfer.productId,
        warehouseId: transfer.fromWarehouseId,
        correlationId: referenceId,
        localAvailable: sourceStock?.availableQty ?? 0,
      });

      const updated = await this.transferRepository.decide(
        transfer.id,
        {
          decidedBy: input.decidedBy,
          note: input.note ?? 'Sent. The destination warehouse manager can receive the products.',
          status: 'AWAITING_RECEIPT',
          variantId: plan.length === 1 ? plan[0].variantId : undefined,
        },
        tx
      );

      return {
        transfer: updated,
        fromWarehouse: withAvailability(sourceStock!),
        toWarehouse: null,
      };
    });
  }

  async assertCanReceiveTransfer(transferId: string, viewer: StockViewer) {
    if (viewer.kind === 'all') return;
    const transfer = await this.transferRepository.findById(transferId);
    if (!transfer) throw new NotFoundError('Transfer not found');
    if (transfer.status !== 'AWAITING_RECEIPT') {
      throw new ValidationError('This transfer is not waiting to be received');
    }
    if (viewer.kind !== 'owner') {
      throw new AppError('Only the destination warehouse manager can receive this transfer', 403, 'FORBIDDEN');
    }
    const destination = await this.warehouseRepository.findById(transfer.toWarehouseId);
    if (!destination || destination.createdBy !== viewer.userId) {
      throw new AppError('Only the destination warehouse manager can receive this transfer', 403, 'FORBIDDEN');
    }
  }

  async receiveTransfer(input: { transferId: string; decidedBy?: string; note?: string }) {
    return prisma.$transaction(async (tx) => {
      const transfer = await this.transferRepository.findById(input.transferId, tx);
      if (!transfer) throw new NotFoundError('Transfer not found');
      if (transfer.status !== 'AWAITING_RECEIPT') {
        throw new ValidationError('This transfer is not waiting to be received');
      }
      const destination = await this.warehouseRepository.findById(transfer.toWarehouseId, tx);
      if (!destination) throw new NotFoundError('Destination warehouse not found');
      const referenceId = transfer.referenceId ?? transfer.id;

      if (transfer.fromSellerUserId) {
        await this.debitSellerStock(tx, {
          userId: transfer.fromSellerUserId,
          productId: transfer.productId,
          variantId: transfer.variantId,
          quantity: transfer.quantity,
        });
        const received = await this.applyDelta(tx, {
          warehouseId: transfer.toWarehouseId,
          productId: transfer.productId,
          variantId: transfer.variantId,
          delta: transfer.quantity,
        });
        await this.movementRepository.create({
          warehouseId: transfer.toWarehouseId,
          productId: transfer.productId,
          variantId: transfer.variantId,
          movementType: 'TRANSFER_IN',
          quantity: received.afterQty - received.beforeQty,
          beforeQty: received.beforeQty,
          afterQty: received.afterQty,
          referenceType: 'SELLER_TRANSFER',
          referenceId,
          createdBy: input.decidedBy ?? transfer.requestedBy,
          db: tx,
        });
      } else {
        const outs = await this.movementRepository.listByReference(referenceId, 'TRANSFER_OUT', tx);
        if (outs.length === 0) {
          throw new ValidationError('This transfer has not left the source warehouse');
        }
        for (const out of outs) {
          const quantity = Math.abs(out.quantity);
          if (quantity <= 0) continue;
          const received = await this.applyDelta(tx, {
            warehouseId: transfer.toWarehouseId,
            productId: out.productId,
            variantId: out.variantId,
            delta: quantity,
          });
          await this.movementRepository.create({
            warehouseId: transfer.toWarehouseId,
            productId: out.productId,
            variantId: out.variantId,
            movementType: 'TRANSFER_IN',
            quantity: received.afterQty - received.beforeQty,
            beforeQty: received.beforeQty,
            afterQty: received.afterQty,
            referenceType: transfer.referenceType ?? 'TRANSFER',
            referenceId,
            createdBy: input.decidedBy ?? transfer.requestedBy,
            db: tx,
          });
        }
      }

      const updated = await this.transferRepository.decide(
        transfer.id,
        {
          decidedBy: input.decidedBy,
          note: input.note ?? 'Destination warehouse received the products.',
          status: 'APPROVED',
        },
        tx,
      );
      return { transfer: updated };
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

  /**
   * Stock for a product can sit on a different variant row than the transfer
   * recorded (the transfer form no longer sends a variant). Take from every
   * row in the source warehouse until the requested quantity is covered.
   */
  private movableQty(row: Pick<InventoryStock, 'onHandQty' | 'reservedQty' | 'availableQty'>) {
    const onHand = Number(row.onHandQty) || 0;
    const reserved = Number(row.reservedQty) || 0;
    const available = Number(row.availableQty) || 0;
    return Math.max(0, available, onHand - reserved);
  }

  private async notEnoughStockMessage(
    tx: Prisma.TransactionClient,
    transfer: { fromWarehouseId: string; productId: string; quantity: number },
    rows: InventoryStock[],
    warehouseName: string
  ) {
    const onHand = rows.reduce((sum, row) => sum + (Number(row.onHandQty) || 0), 0);
    const reserved = rows.reduce((sum, row) => sum + (Number(row.reservedQty) || 0), 0);
    const available = rows.reduce((sum, row) => sum + this.movableQty(row), 0);
    const reservedNote =
      reserved > 0 ? ` On hand is ${onHand}, and ${reserved} is reserved.` : '';

    const elsewhere = (
      await this.inventoryRepository.listByProduct(transfer.productId, tx)
    ).filter((row) => row.warehouseId !== transfer.fromWarehouseId && this.movableQty(row) > 0);
    const elsewhereQty = elsewhere.reduce((sum, row) => sum + this.movableQty(row), 0);
    const elsewhereNote =
      elsewhereQty > 0
        ? ` Other warehouses have ${elsewhereQty}, and that stock is not part of this transfer.`
        : '';

    return `Not enough stock in ${warehouseName}. Available ${available}, requested ${transfer.quantity}.${reservedNote}${elsewhereNote}`;
  }

  private async planTransferDeductions(
    tx: Prisma.TransactionClient,
    transfer: { fromWarehouseId: string; productId: string; variantId: string; quantity: number },
    warehouseName: string
  ): Promise<Array<{ variantId: string; quantity: number }>> {
    const rows = await this.inventoryRepository.listByProductInWarehouse(
      transfer.fromWarehouseId,
      transfer.productId,
      tx
    );

    const preferred = transfer.variantId || '';
    const ranked = [...rows].sort((a, b) => {
      if (a.variantId === preferred && b.variantId !== preferred) return -1;
      if (b.variantId === preferred && a.variantId !== preferred) return 1;
      return this.movableQty(b) - this.movableQty(a);
    });

    let remaining = transfer.quantity;
    const plan: Array<{ variantId: string; quantity: number }> = [];
    for (const row of ranked) {
      if (remaining <= 0) break;
      const movable = this.movableQty(row);
      if (movable <= 0) continue;
      const take = Math.min(movable, remaining);
      plan.push({ variantId: row.variantId, quantity: take });
      remaining -= take;
    }

    if (remaining > 0 || plan.length === 0) {
      throw new ValidationError(
        await this.notEnoughStockMessage(tx, transfer, rows, warehouseName)
      );
    }

    return plan;
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

    const onHand = Number(locked.onHandQty) || 0;
    const reserved = Number(locked.reservedQty) || 0;
    const recordedAvailable = Number(locked.availableQty) || 0;
    const computedAvailable = onHand - reserved;
    const beforeAvailable = Math.max(0, computedAvailable, recordedAvailable);
    if (params.minAvailable !== undefined && beforeAvailable < params.minAvailable) {
      throw new ValidationError(
        params.errorMessage
          ? `${params.errorMessage}. Available ${beforeAvailable}, requested ${params.minAvailable}.`
          : `Not enough stock. Available ${beforeAvailable}, requested ${params.minAvailable}.`
      );
    }

    const beforeQty = recordedAvailable > computedAvailable ? recordedAvailable + reserved : onHand;
    const afterQty = beforeQty + params.delta;
    if (afterQty < 0) {
      throw new ValidationError(
        params.errorMessage
          ? `${params.errorMessage}. Available ${beforeAvailable}, requested ${params.minAvailable ?? Math.abs(params.delta)}.`
          : 'Cannot reduce stock below zero'
      );
    }

    const stock = await this.inventoryRepository.setQuantities(
      locked.id,
      {
        onHandQty: afterQty,
        reservedQty: reserved,
        availableQty: afterQty - reserved,
      },
      tx
    );

    return { beforeQty, afterQty, stock };
  }
}
