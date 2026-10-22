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
import logger from '@/utils/logger';
import {
  parseVariantId,
  resolveVariantId,
  resolveVariantIdFromLine,
  variantsMatch,
} from '@/utils/variantKey';
import { buildInventoryVariantBreakdown } from '@/utils/inventoryVariantBreakdown';
import { takeMatchingPoItem } from '@/utils/matchReceiptPoItem';
import { assertWarehouseCanAcceptUnits } from '@/utils/warehouseCapacity';

type Db = Prisma.TransactionClient | typeof prisma;

export const toAvailabilityStatus = (availableQty: number) => {
  if (availableQty <= 0) return 'OUT_OF_STOCK';
  if (availableQty <= env.LOW_STOCK_THRESHOLD) return 'LOW_STOCK';
  return 'IN_STOCK';
};

const INBOUND_MOVEMENT_TYPES: MovementType[] = [
  'PURCHASE_RECEIVED',
  'RETURN_RECEIVED',
  'INITIAL_BALANCE',
];

export const withAvailability = (stock: InventoryStock) => {
  const parsed = parseVariantId(stock.variantId);
  const colorName = parsed.colorName || null;
  const sizeName = parsed.sizeName || null;
  const variantLabel =
    [colorName, sizeName].filter(Boolean).join(' / ') || parsed.label || null;
  return {
    ...stock,
    availability: toAvailabilityStatus(stock.availableQty),
    colorName,
    sizeName,
    variantLabel,
  };
};

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
  async purchasedLines(
    userId: string | string[],
  ): Promise<Array<{ warehouseId: string; productId: string; variantId?: string }>> {
    const ids = [...new Set((Array.isArray(userId) ? userId : [userId]).map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    const receipts = await prisma.purchaseReceipt.findMany({
      where: {
        status: 'POSTED',
        purchaseOrder: { createdBy: { in: ids } },
      },
      select: {
        warehouseId: true,
        items: {
          select: {
            productId: true,
            variantId: true,
            acceptedQty: true,
            quantity: true,
            purchaseOrderItem: true,
          },
        },
      },
    });
    const seen = new Set<string>();
    const lines: Array<{ warehouseId: string; productId: string; variantId?: string }> = [];
    for (const receipt of receipts) {
      for (const item of receipt.items) {
        const qty = item.acceptedQty ?? item.quantity;
        if (qty <= 0) continue;
        const variantId = resolveVariantIdFromLine(item.purchaseOrderItem, item.variantId);
        const key = `${receipt.warehouseId}:${item.productId}:${variantId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({ warehouseId: receipt.warehouseId, productId: item.productId, variantId });
      }
    }
    return lines;
  }

  async purchasedWarehouseIds(userId: string | string[]): Promise<string[]> {
    const lines = await this.purchasedLines(userId);
    return [...new Set(lines.map((line) => line.warehouseId))];
  }

  /**
   * Warehouses a seller should see on Inventory Data: receipt destinations plus
   * any warehouse that currently holds stock for products they purchased
   * (e.g. after a warehouse→warehouse transfer).
   */
  async sellerVisibleWarehouseIds(userId: string | string[]): Promise<string[]> {
    const lines = await this.purchasedLines(userId);
    const fromReceipts = lines.map((line) => line.warehouseId);
    const productIds = [...new Set(lines.map((line) => line.productId))];
    if (productIds.length === 0) return [...new Set(fromReceipts)];

    const stockRows = await prisma.inventoryStock.findMany({
      where: {
        productId: { in: productIds },
        OR: [{ onHandQty: { gt: 0 } }, { availableQty: { gt: 0 } }],
      },
      select: { warehouseId: true },
      distinct: ['warehouseId'],
    });
    return [...new Set([...fromReceipts, ...stockRows.map((row) => row.warehouseId)])];
  }

  private async warehouseIdsForUsers(userIds: string[]): Promise<string[]> {
    const lists = await Promise.all(
      userIds.filter(Boolean).flatMap((userId) => [
        this.warehouseRepository.listIdsByCreatedBy(userId),
        this.warehouseRepository.listIdsBySellerUserId(userId),
      ]),
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

    // Split legacy blank-variant rows using color/size from posted goods receipts.
    await this.reconcileVariantStockForWarehouse(warehouseId);

    const stocks = await this.inventoryRepository.listByWarehouse(warehouseId);
    const specs = await this.variantSpecsForWarehouse(warehouseId);
    const enrich = (stock: InventoryStock) => {
      const base = withAvailability(stock);
      const parsed = parseVariantId(stock.variantId);
      const spec =
        specs.get(`${stock.productId}::${stock.variantId}`) ||
        (parsed.colorId || parsed.sizeId
          ? specs.get(`${stock.productId}::${parsed.colorId}::${parsed.sizeId}`)
          : undefined);
      if (!spec) return base;
      const colorName = base.colorName || spec.colorName;
      const sizeName = base.sizeName || spec.sizeName;
      const variantLabel =
        [colorName, sizeName].filter(Boolean).join(' / ') ||
        base.variantLabel ||
        spec.variantLabel ||
        null;
      return {
        ...base,
        colorName,
        sizeName,
        variantLabel,
        length: spec.length,
        width: spec.width,
        height: spec.height,
        weightPerUnit: spec.weightPerUnit,
        volumePerUnit: spec.volumePerUnit,
        unit: spec.unit,
      };
    };

    if (viewer.kind === 'all') return stocks.map(enrich);

    if (viewer.kind === 'owner') {
      if (warehouse.createdBy !== viewer.userId) throw new NotFoundError('Warehouse not found');
      return stocks.map(enrich);
    }

    const sellerIds = this.sellerIdentity(viewer);
    if (
      (warehouse.createdBy && sellerIds.includes(warehouse.createdBy)) ||
      (warehouse.sellerUserId && sellerIds.includes(warehouse.sellerUserId))
    ) {
      return stocks.map(enrich);
    }

    const lines = await this.purchasedLines(sellerIds);
    // Products this seller purchased (any warehouse) — show wherever stock sits now.
    const purchasedProductIds = new Set(lines.map((line) => line.productId));
    const allowed = new Set(
      lines.map((line) => `${line.productId}::${line.variantId ?? ''}`),
    );
    const visible = stocks.filter((stock) => {
      if (allowed.has(`${stock.productId}::${stock.variantId}`)) return true;
      return purchasedProductIds.has(stock.productId);
    });
    if (visible.length === 0) throw new NotFoundError('Warehouse not found');
    return visible.map(enrich);
  }

  /** Latest PO-line specs (dimensions / weight) keyed by productId::variantId for a warehouse. */
  private async variantSpecsForWarehouse(warehouseId: string) {
    type PoLine = {
      id: string;
      productId: string;
      variantId?: string | null;
      colorId?: string | null;
      sizeId?: string | null;
      colorName?: string | null;
      sizeName?: string | null;
      length?: unknown;
      width?: unknown;
      height?: unknown;
      weightPerUnit?: unknown;
      volumePerUnit?: unknown;
      unit?: string | null;
      quantity?: number;
      acceptedQty?: number;
    };
    type Spec = {
      colorName: string | null;
      sizeName: string | null;
      variantLabel: string | null;
      length: number | null;
      width: number | null;
      height: number | null;
      weightPerUnit: number | null;
      volumePerUnit: number | null;
      unit: string | null;
    };
    const map = new Map<string, Spec>();
    const toNum = (value: unknown) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const putSpec = (productId: string, variantId: string, poItem: PoLine | null | undefined) => {
      const key = `${productId}::${variantId}`;
      if (map.has(key)) return;
      const parsed = parseVariantId(variantId);
      const colorName = poItem?.colorName || parsed.colorName || null;
      const sizeName = poItem?.sizeName || parsed.sizeName || null;
      const spec: Spec = {
        colorName,
        sizeName,
        variantLabel: [colorName, sizeName].filter(Boolean).join(' / ') || null,
        length: toNum(poItem?.length),
        width: toNum(poItem?.width),
        height: toNum(poItem?.height),
        weightPerUnit: toNum(poItem?.weightPerUnit),
        volumePerUnit: toNum(poItem?.volumePerUnit),
        unit: poItem?.unit ?? null,
      };
      map.set(key, spec);
      // Also index by color×size so ID-only inventory keys still resolve names.
      if (parsed.colorId || parsed.sizeId) {
        map.set(`${productId}::${parsed.colorId}::${parsed.sizeId}`, spec);
      }
    };

    const receipts = await prisma.purchaseReceipt.findMany({
      where: { warehouseId, status: 'POSTED' },
      orderBy: { receivedAt: 'desc' },
      include: {
        items: { include: { purchaseOrderItem: true } },
        purchaseOrder: { include: { items: true } },
      },
    });

    for (const receipt of receipts) {
      const unusedPoItems = [...(receipt.purchaseOrder.items as unknown as PoLine[])];
      for (const item of receipt.items) {
        const poItem = takeMatchingPoItem(
          unusedPoItems,
          item,
          (item.purchaseOrderItem as PoLine | null) ?? null,
        );
        const variantId = resolveVariantIdFromLine(poItem, item.variantId);
        putSpec(item.productId, variantId, poItem);
      }
    }
    return map;
  }

  /**
   * Moves quantities from inventory rows with empty variantId onto per-variant rows
   * derived from posted GRN lines + purchase_order_items color/size.
   */
  async reconcileVariantStockForWarehouse(warehouseId: string) {
    const blankRows = await prisma.inventoryStock.count({
      where: { warehouseId, variantId: '', onHandQty: { gt: 0 } },
    });
    if (blankRows === 0) return;

    const receipts = await prisma.purchaseReceipt.findMany({
      where: { warehouseId, status: 'POSTED' },
      include: {
        items: true,
        purchaseOrder: { include: { items: true } },
      },
    });
    if (receipts.length === 0) return;

    type Agg = { productId: string; variantId: string; qty: number };
    const received = new Map<string, Agg>();

    for (const receipt of receipts) {
      const unusedPoItems = [...receipt.purchaseOrder.items];
      for (const item of receipt.items) {
        const poItem = takeMatchingPoItem(unusedPoItems, item);

        const variantId = resolveVariantIdFromLine(poItem, item.variantId);
        if (!variantId) continue;
        const qty = item.acceptedQty ?? item.quantity;
        if (qty <= 0) continue;

        // Persist resolved keys on receipt / PO lines for later receives.
        if (item.variantId !== variantId) {
          await prisma.purchaseReceiptItem.update({
            where: { id: item.id },
            data: { variantId },
          });
        }
        if (poItem && poItem.variantId !== variantId) {
          await prisma.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { variantId },
          });
        }

        const key = `${item.productId}::${variantId}`;
        const prev = received.get(key);
        if (prev) prev.qty += qty;
        else received.set(key, { productId: item.productId, variantId, qty });
      }
    }

    if (received.size === 0) return;

    const byProduct = new Map<string, Agg[]>();
    for (const agg of received.values()) {
      const list = byProduct.get(agg.productId) ?? [];
      list.push(agg);
      byProduct.set(agg.productId, list);
    }

    await prisma.$transaction(async (tx) => {
      for (const [productId, variants] of byProduct) {
        const blank = await tx.inventoryStock.findUnique({
          where: {
            warehouseId_productId_variantId: { warehouseId, productId, variantId: '' },
          },
        });
        if (!blank || blank.onHandQty <= 0) continue;

        const existingVariantRows = await tx.inventoryStock.findMany({
          where: { warehouseId, productId, NOT: { variantId: '' } },
        });
        // Already split into variant rows — don't reshuffle.
        if (existingVariantRows.some((row) => row.onHandQty > 0)) continue;

        const receiptTotal = variants.reduce((sum, row) => sum + row.qty, 0);
        if (receiptTotal <= 0) continue;

        let remainingOnHand = blank.onHandQty;
        let remainingReserved = blank.reservedQty;

        for (let index = 0; index < variants.length; index += 1) {
          const variant = variants[index];
          const isLast = index === variants.length - 1;
          const target = isLast
            ? remainingOnHand
            : Math.min(
                remainingOnHand,
                Math.max(0, Math.round((blank.onHandQty * variant.qty) / receiptTotal)),
              );
          if (target <= 0 && !isLast) continue;

          const reservedTake = isLast
            ? remainingReserved
            : Math.min(
                remainingReserved,
                Math.round((blank.reservedQty * variant.qty) / receiptTotal),
              );

          await this.inventoryRepository.ensureRow(warehouseId, productId, variant.variantId, tx);
          const locked = await this.inventoryRepository.lockByKey(
            warehouseId,
            productId,
            variant.variantId,
            tx,
          );
          const onHandQty = locked.onHandQty + target;
          const reservedQty = locked.reservedQty + reservedTake;
          await this.inventoryRepository.setQuantities(
            locked.id,
            {
              onHandQty,
              reservedQty,
              availableQty: Math.max(0, onHandQty - reservedQty),
            },
            tx,
          );

          remainingOnHand -= target;
          remainingReserved -= reservedTake;
        }

        await this.inventoryRepository.setQuantities(
          blank.id,
          {
            onHandQty: Math.max(0, remainingOnHand),
            reservedQty: Math.max(0, remainingReserved),
            availableQty: Math.max(0, remainingOnHand - remainingReserved),
          },
          tx,
        );
      }
    });
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
    let rows;
    if (viewer.kind === 'all') {
      rows = await this.movementRepository.list(input);
    } else if (viewer.kind === 'owner') {
      const warehouseIds = await this.warehouseRepository.listIdsByCreatedBy(viewer.userId);
      if (input.warehouseId && !warehouseIds.includes(input.warehouseId)) return [];
      rows = await this.movementRepository.list({
        ...input,
        warehouseIds: input.warehouseId ? undefined : warehouseIds,
      });
    } else {
      const sellerIds = this.sellerIdentity(viewer);
      const [ownedIds, lines] = await Promise.all([
        this.warehouseIdsForUsers(sellerIds),
        this.purchasedLines(sellerIds),
      ]);
      rows = await this.movementRepository.list({
        ...input,
        or: [
          ...ownedIds.map((warehouseId) => ({ warehouseId })),
          ...lines.map((line) => ({ warehouseId: line.warehouseId, productId: line.productId })),
        ],
      });
    }
    return this.enrichTransferRouting(rows);
  }

  /**
   * Attach from/to warehouse labels for transfer movements.
   * Pairing OUT/IN in the UI fails when each warehouse only sees its own rows;
   * the transfer record always knows both sides.
   */
  private async enrichTransferRouting<T extends {
    warehouseId: string;
    movementType: MovementType;
    referenceId: string | null;
  }>(rows: T[]) {
    const refIds = [
      ...new Set(
        rows
          .filter(
            (row) =>
              (row.movementType === 'TRANSFER_OUT' || row.movementType === 'TRANSFER_IN') &&
              Boolean(row.referenceId),
          )
          .map((row) => row.referenceId as string),
      ),
    ];
    if (refIds.length === 0) {
      return rows.map((row) => ({
        ...row,
        fromWarehouseId: null as string | null,
        toWarehouseId: null as string | null,
        fromWarehouseName: null as string | null,
        toWarehouseName: null as string | null,
      }));
    }

    const transfers = await prisma.warehouseTransfer.findMany({
      where: {
        OR: [{ id: { in: refIds } }, { referenceId: { in: refIds } }],
      },
    });
    const transferByRef = new Map<string, (typeof transfers)[number]>();
    for (const transfer of transfers) {
      transferByRef.set(transfer.id, transfer);
      if (transfer.referenceId) transferByRef.set(transfer.referenceId, transfer);
    }

    const warehouseIds = new Set<string>();
    for (const transfer of transfers) {
      if (transfer.fromWarehouseId) warehouseIds.add(transfer.fromWarehouseId);
      warehouseIds.add(transfer.toWarehouseId);
    }
    for (const row of rows) warehouseIds.add(row.warehouseId);

    const warehouses =
      warehouseIds.size > 0
        ? await prisma.warehouse.findMany({
            where: { id: { in: [...warehouseIds] } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));

    return rows.map((row) => {
      if (row.movementType !== 'TRANSFER_OUT' && row.movementType !== 'TRANSFER_IN') {
        return {
          ...row,
          fromWarehouseId: null as string | null,
          toWarehouseId: null as string | null,
          fromWarehouseName: null as string | null,
          toWarehouseName: null as string | null,
        };
      }

      const transfer = row.referenceId ? transferByRef.get(row.referenceId) : undefined;
      if (!transfer) {
        const selfName = nameById.get(row.warehouseId) ?? null;
        return {
          ...row,
          fromWarehouseId: row.movementType === 'TRANSFER_OUT' ? row.warehouseId : null,
          toWarehouseId: row.movementType === 'TRANSFER_IN' ? row.warehouseId : null,
          fromWarehouseName: row.movementType === 'TRANSFER_OUT' ? selfName : null,
          toWarehouseName: row.movementType === 'TRANSFER_IN' ? selfName : null,
        };
      }

      const fromWarehouseId = transfer.fromWarehouseId;
      const toWarehouseId = transfer.toWarehouseId;
      return {
        ...row,
        fromWarehouseId,
        toWarehouseId,
        fromWarehouseName: fromWarehouseId
          ? nameById.get(fromWarehouseId) ?? null
          : transfer.fromSellerUserId
            ? 'Seller stock'
            : null,
        toWarehouseName: nameById.get(toWarehouseId) ?? null,
      };
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
    // Promote seller-initiated transfers stuck as PENDING ("Waiting for seller").
    const stuck = await prisma.warehouseTransfer.findMany({
      where: {
        status: 'PENDING',
        fromSellerUserId: null,
        approvalSellerUserId: { not: null },
        requestedBy: { not: null },
        fromWarehouseId: { not: null },
      },
      select: {
        id: true,
        requestedBy: true,
        approvalSellerUserId: true,
        fromWarehouseId: true,
      },
      take: 100,
    });
    if (stuck.length > 0) {
      const warehouseIds = [
        ...new Set(stuck.map((row) => row.fromWarehouseId).filter((id): id is string => Boolean(id))),
      ];
      const warehouses = await prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, sellerUserId: true },
      });
      const sellerByWarehouse = new Map(
        warehouses.map((warehouse) => [warehouse.id, warehouse.sellerUserId ?? null]),
      );
      const healIds = stuck
        .filter((row) => {
          if (!row.requestedBy) return false;
          if (row.requestedBy === row.approvalSellerUserId) return true;
          const warehouseSeller = row.fromWarehouseId
            ? sellerByWarehouse.get(row.fromWarehouseId)
            : null;
          return Boolean(warehouseSeller && warehouseSeller === row.requestedBy);
        })
        .map((row) => row.id);
      if (healIds.length > 0) {
        await prisma.warehouseTransfer.updateMany({
          where: { id: { in: healIds } },
          data: {
            status: 'SELLER_APPROVED',
            note: 'Auto-approved (seller-initiated warehouse transfer).',
          },
        });
      }
    }

    if (viewer.kind === 'all') return this.transferRepository.list(input);
    if (viewer.kind === 'owner') {
      const ids = await this.warehouseRepository.listIdsByCreatedBy(viewer.userId);
      if (input.status === 'PENDING') {
        return this.transferRepository.list({ ...input, managerPendingIds: ids });
      }
      return this.transferRepository.list({ ...input, touchingWarehouseIds: ids });
    }
    const sellerIds = this.sellerIdentity(viewer);
    const [owned, visibleWarehouses, purchaseLines] = await Promise.all([
      this.warehouseIdsForUsers(sellerIds),
      this.sellerVisibleWarehouseIds(sellerIds),
      this.purchasedLines(sellerIds),
    ]);
    const sellerProductIds = [...new Set(purchaseLines.map((line) => line.productId))];
    const sellerWarehouseIds = [...new Set([...owned, ...visibleWarehouses])];
    // Include WM requests for this seller's products/warehouses — not only exact approvalSellerUserId match.
    return this.transferRepository.list({
      ...input,
      sellerUserIds: sellerIds,
      sellerWarehouseIds,
      sellerProductIds,
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

    // Seller may move purchased products between any warehouses that hold that stock
    // (not only the original goods-receipt warehouse).
    const lines = await this.purchasedLines(sellerIds);
    const purchasedProduct = lines.some((line) => line.productId === input.productId);
    if (!purchasedProduct) {
      throw new AppError('You can only transfer products from your purchases', 403, 'FORBIDDEN');
    }
    const stock = await this.inventoryRepository.listByProductInWarehouse(
      input.fromWarehouseId,
      input.productId,
    );
    const hasStock = stock.some((row) => row.availableQty > 0 || row.onHandQty > 0);
    if (!hasStock) {
      throw new AppError(
        'No available stock for this product in the source warehouse',
        403,
        'FORBIDDEN',
      );
    }
  }

  async assertCanDecideTransfer(transferId: string, viewer: StockViewer) {
    if (viewer.kind === 'all') return;
    const transfer = await this.transferRepository.findById(transferId);
    if (!transfer) throw new NotFoundError('Transfer not found');

    if (transfer.approvalSellerUserId && !transfer.fromSellerUserId && transfer.status === 'PENDING') {
      if (viewer.kind !== 'seller') {
        throw new AppError('Only the seller can approve or reject this transfer request', 403, 'FORBIDDEN');
      }
      const sellerIds = this.sellerIdentity(viewer);
      if (sellerIds.includes(transfer.approvalSellerUserId)) return;

      const source = await this.warehouseRepository.findById(transfer.fromWarehouseId ?? '');
      if (source?.sellerUserId && sellerIds.includes(source.sellerUserId)) return;

      const lines = await this.purchasedLines(sellerIds);
      const ownsProduct = lines.some((line) => line.productId === transfer.productId);
      if (ownsProduct) return;

      throw new AppError('Only the seller can approve or reject this transfer request', 403, 'FORBIDDEN');
    }

    if (transfer.status === 'SELLER_APPROVED') {
      // After seller approval (or seller-initiated skip), only source WM completes.
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
    variantId?: string | null,
  ): Promise<number> {
    const rows = await this.inventoryRepository.listByProductInWarehouse(warehouseId, productId, db);
    const scoped = variantId
      ? rows.filter((row) => variantsMatch(row.variantId, variantId))
      : rows;
    return scoped.reduce((sum, row) => sum + this.movableQty(row), 0);
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
      /** When set, only issue from matching color×size inventory rows. */
      variantId?: string | null;
    },
  ): Promise<Array<{ variantId: string; quantity: number }>> {
    const rows = await this.inventoryRepository.listByProductInWarehouse(
      input.warehouseId,
      input.productId,
      tx,
    );
    const scoped = input.variantId
      ? rows.filter((row) => variantsMatch(row.variantId, input.variantId))
      : rows;
    const ranked = [...scoped].sort((a, b) => this.movableQty(b) - this.movableQty(a));
    let remaining = input.quantity;
    const issued: Array<{ variantId: string; quantity: number }> = [];
    let lastAvailable = 0;

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
      issued.push({ variantId: row.variantId ?? '', quantity: take });
      lastAvailable = moved.stock.availableQty;
      remaining -= take;
    }

    if (remaining > 0) {
      throw new ValidationError('Not enough stock');
    }

    await this.publishStockChange(tx, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      correlationId: input.referenceId,
      localAvailable: lastAvailable,
    });

    return issued;
  }

  /**
   * Customer checkout: take warehouse stock across locations for this product/variation.
   * Catalog stock is already reduced by product-service; do not fail the event if a row is short.
   */
  async issueCustomerSale(input: {
    productId: string;
    quantity: number;
    variantId?: string | null;
    colorId?: string | null;
    sizeId?: string | null;
    referenceId: string;
  }): Promise<void> {
    if (input.quantity <= 0) return;

    await prisma.$transaction(async (tx) => {
      const rows = await this.inventoryRepository.listByProduct(input.productId, tx);
      const wanted = resolveVariantId({
        variantId: input.variantId,
        colorId: input.colorId,
        sizeId: input.sizeId,
      });
      const matched = wanted
        ? rows.filter((row) => variantsMatch(row.variantId, wanted))
        : rows;
      const pool = (matched.length > 0 ? matched : rows).sort(
        (a, b) => this.movableQty(b) - this.movableQty(a),
      );

      let remaining = input.quantity;
      const touchedWarehouseIds = new Set<string>();
      let lastAvailable = 0;

      for (const row of pool) {
        if (remaining <= 0) break;
        const movable = this.movableQty(row);
        if (movable <= 0) continue;
        const take = Math.min(movable, remaining);
        const moved = await this.applyDelta(tx, {
          warehouseId: row.warehouseId,
          productId: input.productId,
          variantId: row.variantId,
          delta: -take,
          minAvailable: take,
          errorMessage: 'Not enough stock',
        });
        await this.movementRepository.create({
          warehouseId: row.warehouseId,
          productId: input.productId,
          variantId: row.variantId,
          movementType: 'SALE_ISSUED',
          quantity: moved.afterQty - moved.beforeQty,
          beforeQty: moved.beforeQty,
          afterQty: moved.afterQty,
          referenceType: 'CUSTOMER_ORDER',
          referenceId: input.referenceId,
          createdBy: null,
          db: tx,
        });
        touchedWarehouseIds.add(row.warehouseId);
        lastAvailable = moved.stock.availableQty;
        remaining -= take;
      }

      if (remaining > 0) {
        logger.warn(
          {
            productId: input.productId,
            referenceId: input.referenceId,
            remaining,
          },
          'customer sale: warehouse inventory short after catalog confirm',
        );
      }

      for (const warehouseId of touchedWarehouseIds) {
        await this.publishStockChange(tx, {
          productId: input.productId,
          warehouseId,
          correlationId: input.referenceId,
          localAvailable: lastAvailable,
        });
      }
    });
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
   * Registers a warehouse→warehouse transfer.
   * - Seller-initiated: skips seller approval (SELLER_APPROVED) — they moved it themselves.
   * - Warehouse-manager-initiated: PENDING until the linked seller approves.
   * Stock still moves only when `approveTransfer` completes the transfer.
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
    /** True when the authenticated actor is a seller (not a warehouse manager). */
    sellerInitiated?: boolean;
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
    await assertWarehouseCanAcceptUnits(toWarehouse, input.quantity, 'transfer');

    const approvalSellerUserId = await this.sellerForWarehouseProduct(
      input.fromWarehouseId,
      input.productId,
    );
    const requesterIds = new Set(
      [input.requestedBy, ...(input.requesterIds ?? [])].filter((id): id is string => Boolean(id)),
    );
    // Seller W→W skips the seller-approval step (status SELLER_APPROVED / "Approved").
    // Stock still moves only when the warehouse manager completes the transfer.
    const sellerRequested =
      Boolean(input.sellerInitiated) ||
      requesterIds.has(approvalSellerUserId) ||
      Boolean(fromWarehouse.sellerUserId && requesterIds.has(fromWarehouse.sellerUserId));

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
    await assertWarehouseCanAcceptUnits(destination, input.quantity, 'transfer');
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
      await assertWarehouseCanAcceptUnits(destination, transfer.quantity, 'receive', tx);

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

      // TRANSFER_OUT already published a lower total; republish so product
      // warehouseStockMirror includes stock now sitting at the destination.
      const destStock = await this.inventoryRepository.listByProductInWarehouse(
        transfer.toWarehouseId,
        transfer.productId,
        tx,
      );
      const localAvailable = destStock.reduce(
        (sum, row) => sum + (Number(row.availableQty) || 0),
        0,
      );
      await this.publishStockChange(tx, {
        productId: transfer.productId,
        warehouseId: transfer.toWarehouseId,
        correlationId: referenceId,
        localAvailable,
      });

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
    const inboundUnits = input.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
    await assertWarehouseCanAcceptUnits(warehouse, inboundUnits, 'receive', tx);

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
    if (!shopId) {
      // Inventory row is already updated; without shopId we cannot emit
      // inventory.updated → product/frontend warehouse mirrors stay stale (0).
      // Common when product.created never reached warehouse (consumer down).
      logger.error(
        {
          product_id: params.productId,
          warehouse_id: params.warehouseId,
          correlation_id: params.correlationId,
          local_available: params.localAvailable,
        },
        'inventory.updated skipped: missing product_snapshots.shopId — catalog/storefront will show 0 warehouse stock until snapshot exists and mirrors are republished',
      );
      return null;
    }

    const totals = await this.inventoryRepository.computeTotalsByProductId(params.productId, tx);
    const variantRows = await this.inventoryRepository.listVariantTotalsByProductId(
      params.productId,
      tx,
    );
    const variants = await buildInventoryVariantBreakdown(params.productId, variantRows, tx);
    await this.eventsPublisher.publishInventoryUpdated({
      productId: params.productId,
      shopId,
      totalStock: totals.total,
      availableStock: totals.available,
      variants,
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
