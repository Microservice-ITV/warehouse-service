import env from '@/config/env';
import logger from '@/utils/logger';
import { parseVariantId } from '@/utils/variantKey';

export type ShopStockCredit = {
  productId: string;
  /** Product-service variant UUID when known. */
  variantId?: string;
  /** Inventory color×size key (`v1::…`) or blank — resolved via colorId/sizeId. */
  inventoryVariantId?: string;
  colorId?: string;
  sizeId?: string;
  quantity: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toCreditPayload(item: ShopStockCredit) {
  const parsed = parseVariantId(item.inventoryVariantId ?? item.variantId);
  const variantId =
    item.variantId && UUID_RE.test(item.variantId) ? item.variantId : undefined;
  const colorId = item.colorId || parsed.colorId || undefined;
  const sizeId = item.sizeId || parsed.sizeId || undefined;

  return {
    productId: item.productId,
    quantity: item.quantity,
    ...(variantId ? { variantId } : {}),
    ...(colorId ? { colorId } : {}),
    ...(sizeId ? { sizeId } : {}),
  };
}

/**
 * Credits catalog shop stock in product-service after a warehouse→seller order receive.
 * Uses PRODUCT_SERVICE_URL + SERVICE_API_KEY from warehouse env.
 */
export async function creditProductShopStock(items: ShopStockCredit[]): Promise<void> {
  const credits = items.filter((item) => item.quantity > 0).map(toCreditPayload);
  if (credits.length === 0) return;

  const baseUrl = env.PRODUCT_SERVICE_URL.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/products/credit-shop-stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': env.SERVICE_API_KEY,
      },
      body: JSON.stringify({ items: credits }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error('Failed to credit product shop stock', {
        status: response.status,
        body: text.slice(0, 400),
      });
      throw new Error(`product-service credit-shop-stock failed (${response.status})`);
    }
  } catch (error) {
    logger.error('product-service credit-shop-stock request failed', error as Error);
    throw error;
  }
}
