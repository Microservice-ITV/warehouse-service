import type { Prisma, TransferStatus, WarehouseTransfer } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class TransferRepository {
  async create(
    params: {
      fromWarehouseId?: string | null;
      fromSellerUserId?: string | null;
      toWarehouseId: string;
      productId: string;
      variantId?: string;
      quantity: number;
      referenceId?: string | null;
      referenceType?: string | null;
      requestedBy?: string | null;
      approvalSellerUserId?: string | null;
      status?: TransferStatus;
      db?: Db;
    }
  ): Promise<WarehouseTransfer> {
    const db = params.db ?? prisma;
    return db.warehouseTransfer.create({
      data: {
        fromWarehouseId: params.fromWarehouseId ?? null,
        fromSellerUserId: params.fromSellerUserId ?? null,
        toWarehouseId: params.toWarehouseId,
        productId: params.productId,
        variantId: params.variantId ?? '',
        quantity: params.quantity,
        referenceId: params.referenceId ?? null,
        referenceType: params.referenceType ?? null,
        requestedBy: params.requestedBy ?? null,
        approvalSellerUserId: params.approvalSellerUserId ?? null,
        ...(params.status ? { status: params.status } : {}),
      },
    });
  }

  async findById(id: string, db: Db = prisma): Promise<WarehouseTransfer | null> {
    return db.warehouseTransfer.findUnique({ where: { id } });
  }

  async list(
    params: {
      warehouseId?: string;
      status?: TransferStatus;
      limit?: number;
      fromWarehouseIds?: string[];
      managerPendingIds?: string[];
      touchingWarehouseIds?: string[];
      sellerUserId?: string;
      sellerUserIds?: string[];
      sellerWarehouseIds?: string[];
      approvalSellerUserIds?: string[];
    },
    db: Db = prisma
  ): Promise<WarehouseTransfer[]> {
    const and: Prisma.WarehouseTransferWhereInput[] = [];
    if (params.status) and.push({ status: params.status });
    if (params.warehouseId) {
      and.push({
        OR: [
          { fromWarehouseId: params.warehouseId },
          { toWarehouseId: params.warehouseId },
        ],
      });
    }
    if (params.fromWarehouseIds) and.push({ fromWarehouseId: { in: params.fromWarehouseIds } });
    if (params.managerPendingIds) {
      and.push({
        fromSellerUserId: { not: null },
        toWarehouseId: { in: params.managerPendingIds },
      });
    }
    if (params.approvalSellerUserIds) {
      and.push({ approvalSellerUserId: { in: params.approvalSellerUserIds } });
    }
    if (params.touchingWarehouseIds) {
      and.push({
        OR: [
          { fromWarehouseId: { in: params.touchingWarehouseIds } },
          { toWarehouseId: { in: params.touchingWarehouseIds } },
        ],
      });
    }
    const sellerIds = [
      ...new Set(
        [params.sellerUserId, ...(params.sellerUserIds ?? [])].filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ),
      ),
    ];
    if (sellerIds.length > 0) {
      const sellerOr: Prisma.WarehouseTransferWhereInput[] = [
        { requestedBy: { in: sellerIds } },
        { fromSellerUserId: { in: sellerIds } },
        { approvalSellerUserId: { in: sellerIds } },
      ];
      if (params.sellerWarehouseIds && params.sellerWarehouseIds.length > 0) {
        sellerOr.push({ fromWarehouseId: { in: params.sellerWarehouseIds } });
        sellerOr.push({ toWarehouseId: { in: params.sellerWarehouseIds } });
      }
      and.push({ OR: sellerOr });
    }
    return db.warehouseTransfer.findMany({
      where: and.length > 0 ? { AND: and } : {},
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async decide(
    id: string,
    params: {
      status: TransferStatus;
      decidedBy?: string | null;
      note?: string | null;
      variantId?: string;
    },
    db: Db = prisma
  ): Promise<WarehouseTransfer> {
    return db.warehouseTransfer.update({
      where: { id },
      data: {
        status: params.status,
        decidedBy: params.decidedBy ?? null,
        decidedAt: new Date(),
        note: params.note ?? null,
        ...(params.variantId !== undefined ? { variantId: params.variantId } : {}),
      },
    });
  }
}