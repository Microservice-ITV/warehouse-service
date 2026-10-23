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
 * Owning shop name per product id from product-service.
 * Returns an empty map on failure so callers can still render without labels.
 */
export async function fetchProductShopNames(productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds.filter((id) => UUID_RE.test(id)))];
  if (ids.length === 0) return new Map();

  const baseUrl = env.PRODUCT_SERVICE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/products/shop-names`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': env.SERVICE_API_KEY,
      },
      body: JSON.stringify({ productIds: ids }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'product-service shop-names failed');
      return new Map();
    }
    const body = (await response.json()) as { data?: Record<string, string> };
    return new Map(Object.entries(body.data ?? {}));
  } catch (error) {
    logger.warn({ err: error, url }, 'product-service shop-names request failed');
    return new Map();
  }
}

/**
 * Credits catalog shop stock in product-service after a warehouse→seller order receive.
 * Uses PRODUCT_SERVICE_URL + SERVICE_API_KEY from warehouse env.
 */
export async function creditProductShopStock(items: ShopStockCredit[]): Promise<void> {
  const credits = items.filter((item) => item.quantity > 0).map(toCreditPayload);
  if (credits.length === 0) return;

  const baseUrl = env.PRODUCT_SERVICE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/products/credit-shop-stock`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': env.SERVICE_API_KEY,
      },
      body: JSON.stringify({ items: credits }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error('Failed to credit product shop stock', {
        url,
        status: response.status,
        body: text.slice(0, 400),
      });
      throw new Error(`product-service credit-shop-stock failed (${response.status})`);
    }
  } catch (error) {
    logger.error({ err: error, url }, 'product-service credit-shop-stock request failed');
    throw error;
  }
}
