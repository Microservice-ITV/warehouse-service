import type { Prisma } from '@prisma/client';
import { createEventEnvelope } from '@/events/envelope';
import type { PurchaseGoodsReceivedData, PurchaseGoodsReturnedData } from '@/events/types';
import { OutboxRepository } from '@/repositories/outbox.repository';
import { PurchaseOutboxRepository } from '@/repositories/purchaseOutbox.repository';
import { rabbitConfig } from '@/config/rabbitmq';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

const outboxRepository = new OutboxRepository();
const purchaseOutboxRepository = new PurchaseOutboxRepository();

export class EventsPublisher {
  async publishInventoryUpdated(input: {
    productId: string;
    shopId: string;
    totalStock: number;
    availableStock: number;
    correlationId: string;
    db?: Db;
  }) {
    const availabilityStatus =
      input.availableStock <= 0 ? 'OUT_OF_STOCK' : input.availableStock <= 5 ? 'LOW_STOCK' : 'IN_STOCK';

    const envelope = createEventEnvelope({
      event: 'inventory.updated',
      correlationId: input.correlationId,
      data: {
        productId: input.productId,
        shopId: input.shopId,
        totalStock: input.totalStock,
        availableStock: input.availableStock,
        availabilityStatus,
      },
    });
    await outboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.inventoryUpdated,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }

  async publishInventoryLowStock(input: {
    productId: string;
    shopId: string;
    warehouseId: string;
    availableStock: number;
    threshold: number;
    correlationId: string;
    db?: Db;
  }) {
    const envelope = createEventEnvelope({
      event: 'inventory.low_stock',
      correlationId: input.correlationId,
      data: {
        product_id: input.productId,
        shop_id: input.shopId,
        warehouse_id: input.warehouseId,
        available_stock: input.availableStock,
        threshold: input.threshold,
      },
    });
    await outboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.inventoryLowStock,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }

  /** GRN confirmed inside the purchase domain — emitted from the same transaction. */
  async publishPurchaseGoodsReceived(input: { data: PurchaseGoodsReceivedData; db?: Db }) {
    const envelope = createEventEnvelope({
      event: 'purchase.goods_received',
      correlationId: input.data.receipt_id,
      data: input.data,
    });
    await purchaseOutboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.purchaseGoodsReceived,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }

  /** Supplier return posted inside the purchase domain. */
  async publishPurchaseGoodsReturned(input: { data: PurchaseGoodsReturnedData; db?: Db }) {
    const envelope = createEventEnvelope({
      event: 'purchase.goods_returned',
      correlationId: input.data.return_id,
      data: input.data,
    });
    await purchaseOutboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.purchaseGoodsReturned,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }
}
