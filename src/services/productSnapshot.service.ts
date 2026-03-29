import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { InventoryService } from '@/services/inventory.service';
import type { ProductEventData } from '@/events/types';
import { ValidationError } from '@/utils/errors';

export class ProductSnapshotService {
  private readonly productSnapshotRepository = new ProductSnapshotRepository();
  private readonly inventoryService = new InventoryService();

  async upsertFromProductEvent(data: ProductEventData) {
    if (!data.product_id || !data.shop_id) {
      throw new ValidationError('product_id and shop_id are required');
    }
    if (!data.title) {
      throw new ValidationError('title is required in product event');
    }

    const price = Number(data.price ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      throw new ValidationError('Invalid product price');
    }

    const images = Array.isArray(data.images) ? data.images.map((value) => String(value)) : [];

    await this.inventoryService.ensureInventoryRowsForProduct({
      productId: data.product_id,
      shopId: data.shop_id,
    });

    return this.productSnapshotRepository.upsert({
      productId: data.product_id,
      shopId: data.shop_id,
      categoryId: data.category_id ?? null,
      parentCategoryId: data.parent_category_id ?? null,
      parentCategoryName: data.parent_category_name ?? null,
      parentCategorySlug: data.parent_category_slug ?? null,
      slug: data.slug ?? null,
      title: data.title,
      description: data.description ?? null,
      sku: data.sku ?? null,
      price,
      currency: data.currency ?? 'USD',
      images,
      imageUrl: data.image_url ?? images[0] ?? null,
      isActive: data.is_active ?? true,
    });
  }

  async markDeleted(productId: string) {
    if (!productId) throw new ValidationError('product_id is required');
    await this.productSnapshotRepository.markDeleted(productId);
  }
}
