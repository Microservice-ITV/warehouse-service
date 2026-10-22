import env from '@/config/env';
import logger from '@/utils/logger';

export type CatalogProductSnapshot = {
  productId: string;
  shopId: string;
  title: string;
  description: string | null;
  sku: string | null;
  slug: string | null;
  price: number;
  currency: string;
  images: string[];
  imageUrl: string | null;
  categoryId: string | null;
  isActive: boolean;
};

/**
 * Fetch catalog product for snapshot heal when warehouse missed product.created.
 * Uses public GET /products/:id on product-service.
 */
export async function fetchCatalogProduct(
  productId: string,
): Promise<CatalogProductSnapshot | null> {
  const baseUrl = env.PRODUCT_SERVICE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/products/${encodeURIComponent(productId)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('product-service catalog fetch failed', {
        url,
        status: response.status,
        body: text.slice(0, 300),
      });
      return null;
    }

    const body = (await response.json()) as Record<string, unknown>;
    const data = (body.data ?? body) as Record<string, unknown>;
    const shopId = String(data.shopId ?? data.shop_id ?? '');
    if (!shopId) {
      logger.warn('product-service catalog product missing shopId', { productId });
      return null;
    }

    const images = Array.isArray(data.images)
      ? data.images.map((value) => String(value))
      : [];
    const price = Number(data.price ?? 0);

    return {
      productId,
      shopId,
      title: String(data.name ?? data.title ?? productId),
      description:
        data.description === null || data.description === undefined
          ? null
          : String(data.description),
      sku: data.sku == null ? null : String(data.sku),
      slug: data.slug == null ? null : String(data.slug),
      price: Number.isFinite(price) ? price : 0,
      currency: String(data.currency ?? 'USD'),
      images,
      imageUrl:
        data.imageUrl != null
          ? String(data.imageUrl)
          : data.image_url != null
            ? String(data.image_url)
            : images[0] ?? null,
      categoryId:
        data.categoryId != null
          ? String(data.categoryId)
          : data.category_id != null
            ? String(data.category_id)
            : null,
      isActive: data.isActive !== false && data.is_active !== false,
    };
  } catch (error) {
    logger.error({ err: error, url, productId }, 'product-service catalog fetch error');
    return null;
  }
}
