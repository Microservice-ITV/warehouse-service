/**
 * Match a goods-receipt line to a purchase-order line, consuming from `unusedPoItems`
 * so each PO line is used at most once (same receipt).
 */
export type MatchablePoLine = {
  id: string;
  productId: string;
  quantity?: number | null;
  acceptedQty?: number | null;
};

export type MatchableReceiptLine = {
  productId: string;
  quantity: number;
  acceptedQty?: number | null;
  purchaseOrderItemId?: string | null;
};

export function takeMatchingPoItem<T extends MatchablePoLine>(
  unusedPoItems: T[],
  receiptItem: MatchableReceiptLine,
  linkedPoItem?: T | null,
): T | undefined {
  let poItem =
    linkedPoItem ??
    (receiptItem.purchaseOrderItemId
      ? unusedPoItems.find((line) => line.id === receiptItem.purchaseOrderItemId)
      : undefined);

  if (poItem) {
    const idx = unusedPoItems.findIndex((line) => line.id === poItem!.id);
    if (idx >= 0) unusedPoItems.splice(idx, 1);
    return poItem;
  }

  const accepted = receiptItem.acceptedQty ?? receiptItem.quantity;
  let idx = unusedPoItems.findIndex(
    (line) =>
      line.productId === receiptItem.productId &&
      (line.acceptedQty === accepted ||
        line.quantity === receiptItem.quantity ||
        line.quantity === accepted),
  );
  if (idx < 0) {
    idx = unusedPoItems.findIndex((line) => line.productId === receiptItem.productId);
  }
  if (idx < 0) return undefined;

  poItem = unusedPoItems[idx];
  unusedPoItems.splice(idx, 1);
  return poItem;
}
