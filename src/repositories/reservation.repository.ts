import type { Prisma, ReservationStatus, StockReservation } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class ReservationRepository {
  async findByCheckoutId(checkoutId: string, db: Db = prisma) {
    return db.stockReservation.findUnique({
      where: { checkoutId },
      include: { items: true },
    });
  }

  async findById(id: string, db: Db = prisma) {
    return db.stockReservation.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async createWithItems(params: {
    orderId: string;
    checkoutId: string;
    expiresAt: Date;
    items: Array<{ productId: string; warehouseId: string; quantity: number }>;
    db: Prisma.TransactionClient;
  }): Promise<StockReservation> {
    return params.db.stockReservation.create({
      data: {
        orderId: params.orderId,
        checkoutId: params.checkoutId,
        expiresAt: params.expiresAt,
        status: 'RESERVED',
        items: {
          createMany: {
            data: params.items.map((item) => ({
              productId: item.productId,
              warehouseId: item.warehouseId,
              quantity: item.quantity,
            })),
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: ReservationStatus, db: Db = prisma) {
    return db.stockReservation.update({ where: { id }, data: { status } });
  }

  async findExpiredReservedIds(now: Date, db: Db = prisma): Promise<string[]> {
    const rows = await db.stockReservation.findMany({
      where: { status: 'RESERVED', expiresAt: { lt: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async deleteExpired(cutoff: Date, db: Db = prisma) {
    return db.stockReservation.deleteMany({
      where: {
        status: { in: ['RELEASED', 'EXPIRED'] },
        expiresAt: { lt: cutoff },
      },
    });
  }
}
