import type { Prisma } from '@prisma/client';
import prisma from '@/config/database';
import { parseVariantId } from '@/utils/variantKey';

type Db = Prisma.TransactionClient | typeof prisma;

export type InventoryVariantBreakdown = {
  colorId: string;
  sizeId: string;
  colorName: string;
  sizeName: string;
  availableStock: number;
  totalStock: number;
  /**
   * Landed unit price for this color×size (same as Inventory "Unit price (from PO)"):
   * (PO subtotal + delivery + other costs) / order stock.
   */
  unitCost: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
};

const toNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export type LandedOrder = {
  subtotal: unknown;
  shippingAmount: unknown;
  exchangeRate: unknown;
  receivedExchangeRate: unknown;
  items: Array<{ quantity: unknown }>;
  additionalCosts: Array<{ amount: unknown }>;
};

/**
 * (Subtotal + Delivery + Other costs) / Order stock, rescaled from the PO
 * exchange rate to the received rate (the foreign cost stays fixed).
 */
export const landedUnitPrice = (order: LandedOrder): number | null => {
  const total =
    (Number(order.subtotal) || 0) +
    (Number(order.shippingAmount) || 0) +
    order.additionalCosts.reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0);
  const orderStock = order.items.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  if (orderStock <= 0 || total <= 0) return null;
  const poRate = Number(order.exchangeRate) || 1;
  const receivedRate = Number(order.receivedExchangeRate) || poRate;
  const scale = poRate > 1 ? receivedRate / poRate : 1;
  return Math.round((total / orderStock) * scale * 100) / 100;
};

/**
 * Aggregate on-hand inventory by color×size and attach the latest PO line
 * unit price / dimensions for that color×size (so catalog can mirror them).
 */
export async function buildInventoryVariantBreakdown(
  productId: string,
  variantRows: Array<{ variantId: string; available: number; total: number }>,
  db: Db = prisma,
): Promise<InventoryVariantBreakdown[]> {
  const poItems = await db.purchaseOrderItem.findMany({
    where: { productId },
    orderBy: { createdAt: 'desc' },
    select: {
      variantId: true,
      colorId: true,
      sizeId: true,
      colorName: true,
      sizeName: true,
      unitCost: true,
      length: true,
      width: true,
      height: true,
      weightPerUnit: true,
      purchaseOrderId: true,
      purchaseOrder: {
        select: {
          id: true,
          subtotal: true,
          shippingAmount: true,
          exchangeRate: true,
          receivedExchangeRate: true,
          items: { select: { quantity: true } },
          additionalCosts: { select: { amount: true } },
        },
      },
    },
  });

  type PoSpec = {
    unitCost: number | null;
    length: number | null;
    width: number | null;
    height: number | null;
    weight: number | null;
  };
  const poByIdKey = new Map<string, PoSpec>();
  const poByNameKey = new Map<string, PoSpec>();
  const landedByOrderId = new Map<string, number | null>();

  const orderUnitPrice = (
    order: (LandedOrder & { id: string }) | null | undefined,
    fallbackLineCost: number | null,
  ): number | null => {
    if (!order) return fallbackLineCost;
    if (!landedByOrderId.has(order.id)) landedByOrderId.set(order.id, landedUnitPrice(order));
    return landedByOrderId.get(order.id) ?? fallbackLineCost;
  };

  const putPo = (key: string | null, map: Map<string, PoSpec>, spec: PoSpec) => {
    if (!key || map.has(key)) return;
    map.set(key, spec);
  };

  for (const item of poItems) {
    const parsed = parseVariantId(item.variantId);
    const colorId = (item.colorId || parsed.colorId || '').trim();
    const sizeId = (item.sizeId || parsed.sizeId || '').trim();
    const colorName = (item.colorName || parsed.colorName || '').trim();
    const sizeName = (item.sizeName || parsed.sizeName || '').trim();
    const lineCost = toNum(item.unitCost);
    const spec: PoSpec = {
      unitCost: orderUnitPrice(item.purchaseOrder, lineCost) ?? lineCost,
      length: toNum(item.length),
      width: toNum(item.width),
      height: toNum(item.height),
      weight: toNum(item.weightPerUnit),
    };
    if (colorId && sizeId) putPo(`${colorId}::${sizeId}`, poByIdKey, spec);
    if (colorName && sizeName) {
      putPo(`${colorName.toLowerCase()}::${sizeName.toLowerCase()}`, poByNameKey, spec);
    }
  }

  const latestPo = poItems[0];
  const variantTotals = new Map<string, InventoryVariantBreakdown>();

  const addRow = (
    colorId: string,
    sizeId: string,
    colorName: string,
    sizeName: string,
    available: number,
    total: number,
  ) => {
    if ((!colorId || !sizeId) && (!colorName || !sizeName)) return;
    const idKey = colorId && sizeId ? `${colorId}::${sizeId}` : '';
    const nameKey =
      colorName && sizeName ? `${colorName.toLowerCase()}::${sizeName.toLowerCase()}` : '';
    const mapKey = idKey || `name::${nameKey}`;
    const prev = variantTotals.get(mapKey);
    if (prev) {
      prev.availableStock += available;
      prev.totalStock += total;
      return;
    }
    const po = (idKey && poByIdKey.get(idKey)) || (nameKey && poByNameKey.get(nameKey)) || null;
    variantTotals.set(mapKey, {
      colorId,
      sizeId,
      colorName,
      sizeName,
      availableStock: available,
      totalStock: total,
      unitCost: po?.unitCost ?? null,
      length: po?.length ?? null,
      width: po?.width ?? null,
      height: po?.height ?? null,
      weight: po?.weight ?? null,
    });
  };

  for (const row of variantRows) {
    const parsed = parseVariantId(row.variantId);
    if ((parsed.colorId && parsed.sizeId) || (parsed.colorName && parsed.sizeName)) {
      addRow(
        parsed.colorId,
        parsed.sizeId,
        parsed.colorName,
        parsed.sizeName,
        row.available,
        row.total,
      );
      continue;
    }

    // Blank / legacy variant rows still hold qty — attribute to the latest PO
    // color×size so product warehouseStockMirror does not under-count.
    if (latestPo && row.available + row.total > 0) {
      const parsedPo = parseVariantId(latestPo.variantId);
      addRow(
        (latestPo.colorId || parsedPo.colorId || '').trim(),
        (latestPo.sizeId || parsedPo.sizeId || '').trim(),
        (latestPo.colorName || parsedPo.colorName || '').trim(),
        (latestPo.sizeName || parsedPo.sizeName || '').trim(),
        row.available,
        row.total,
      );
    }
  }

  return [...variantTotals.values()];
}
