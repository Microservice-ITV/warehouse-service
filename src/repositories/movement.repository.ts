import type { Prisma, StockMovementType } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class MovementRepository {
  async create(params: {
    productId: string;
    warehouseId: string;
    type: StockMovementType;
    quantity: number;
    referenceId: string;
    referenceType?: 'UNSPECIFIED' | 'BOOTSTRAP' | 'CHECKOUT' | 'RESERVATION' | 'MANUAL';
    checkoutId?: string;
    orderId?: string;
    reservationId?: string;
    correlationId?: string;
    metadata?: Prisma.InputJsonValue;
    db?: Db;
  }) {
    const db = params.db ?? prisma;
    return db.stockMovement.create({
      data: {
        productId: params.productId,
        warehouseId: params.warehouseId,
        type: params.type,
        quantity: params.quantity,
        referenceId: params.referenceId,
        ...(params.referenceType ? { referenceType: params.referenceType } : {}),
        ...(params.checkoutId ? { checkoutId: params.checkoutId } : {}),
        ...(params.orderId ? { orderId: params.orderId } : {}),
        ...(params.reservationId ? { reservationId: params.reservationId } : {}),
        ...(params.correlationId ? { correlationId: params.correlationId } : {}),
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
    });
  }

  async list(params: { productId?: string; warehouseId?: string; limit?: number }) {
    return prisma.stockMovement.findMany({
      where: {
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }
}
