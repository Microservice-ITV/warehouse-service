import { ProductSnapshotRepository } from '@/repositories/productSnapshot.repository';
import { ReservationService } from '@/services/reservation.service';
import type { ProductEventData } from '@/events/types';
import { ValidationError } from '@/utils/errors';

export class ProductSnapshotService {
  private readonly productSnapshotRepository = new ProductSnapshotRepository();
  private readonly reservationService = new ReservationService();

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

    await this.reservationService.createInventoryForProduct({
      productId: data.product_id,
      shopId: data.shop_id,
      initialStock: data.stock,
    });

    return this.productSnapshotRepository.upsert({
      productId: data.product_id,
      shopId: data.shop_id,
      categoryId: data.category_id ?? null,
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
