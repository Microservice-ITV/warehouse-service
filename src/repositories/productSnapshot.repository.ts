import type { Prisma } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export type ProductSnapshotUpsertInput = {
  productId: string;
  shopId: string;
  categoryId?: string | null;
  parentCategoryId?: string | null;
  parentCategoryName?: string | null;
  parentCategorySlug?: string | null;
  slug?: string | null;
  title: string;
  description?: string | null;
  sku?: string | null;
  price: number;
  currency?: string;
  images?: string[];
  imageUrl?: string | null;
  isActive?: boolean;
};

export class ProductSnapshotRepository {
  async upsert(input: ProductSnapshotUpsertInput, db: Db = prisma) {
    return db.productSnapshot.upsert({
      where: { productId: input.productId },
      create: {
        productId: input.productId,
        shopId: input.shopId,
        categoryId: input.categoryId ?? null,
        parentCategoryId: input.parentCategoryId ?? null,
        parentCategoryName: input.parentCategoryName ?? null,
        parentCategorySlug: input.parentCategorySlug ?? null,
        slug: input.slug ?? null,
        title: input.title,
        description: input.description ?? null,
        sku: input.sku ?? null,
        price: input.price,
        currency: input.currency ?? 'USD',
        images: input.images ?? [],
        imageUrl: input.imageUrl ?? null,
        isActive: input.isActive ?? true,
      },
      update: {
        shopId: input.shopId,
        categoryId: input.categoryId ?? null,
        parentCategoryId: input.parentCategoryId ?? null,
        parentCategoryName: input.parentCategoryName ?? null,
        parentCategorySlug: input.parentCategorySlug ?? null,
        slug: input.slug ?? null,
        title: input.title,
        description: input.description ?? null,
        sku: input.sku ?? null,
        price: input.price,
        currency: input.currency ?? 'USD',
        images: input.images ?? [],
        imageUrl: input.imageUrl ?? null,
        isActive: input.isActive ?? true,
      },
    });
  }

  async markDeleted(productId: string, db: Db = prisma) {
    return db.productSnapshot.updateMany({
      where: { productId },
      data: { isActive: false },
    });
  }

  async findByProductIds(productIds: string[], db: Db = prisma) {
    if (productIds.length === 0) return [];
    return db.productSnapshot.findMany({
      where: { productId: { in: productIds } },
    });
  }
}
