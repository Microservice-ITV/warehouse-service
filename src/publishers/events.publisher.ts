import type { Prisma } from '@prisma/client';
import { createEventEnvelope } from '@/events/envelope';
import { OutboxRepository } from '@/repositories/outbox.repository';
import { rabbitConfig } from '@/config/rabbitmq';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

const outboxRepository = new OutboxRepository();

export class EventsPublisher {
  async publishStockReserved(input: {
    checkoutId: string;
    reservationId: string;
    correlationId: string;
    db?: Db;
  }) {
    const envelope = createEventEnvelope({
      event: 'stock.reserved',
      correlationId: input.correlationId,
      data: {
        checkout_id: input.checkoutId,
        reservation_id: input.reservationId,
      },
    });
    await outboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.stockReserved,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }

  async publishStockRejected(input: {
    checkoutId: string;
    reason: string;
    correlationId: string;
    db?: Db;
  }) {
    const envelope = createEventEnvelope({
      event: 'stock.rejected',
      correlationId: input.correlationId,
      data: {
        checkout_id: input.checkoutId,
        reason: input.reason,
      },
    });
    await outboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.stockRejected,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }

  async publishStockConfirmed(input: {
    checkoutId: string;
    reservationId: string;
    orderId?: string;
    correlationId: string;
    db?: Db;
  }) {
    const envelope = createEventEnvelope({
      event: 'stock.confirmed',
      correlationId: input.correlationId,
      data: {
        checkout_id: input.checkoutId,
        reservation_id: input.reservationId,
        ...(input.orderId ? { order_id: input.orderId } : {}),
      },
    });
    await outboxRepository.enqueue({
      eventId: envelope.event_id,
      event: envelope.event,
      routingKey: rabbitConfig.publish.stockConfirmed,
      payload: envelope,
      db: input.db ?? prisma,
    });
    return envelope;
  }

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
}
