import type { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { InboxRepository } from '@/repositories/inbox.repository';
import { ProcessedRepository } from '@/repositories/processed.repository';
import { ReservationService } from '@/services/reservation.service';
import type { OrderCreatedEvent } from '@/events/types';
import logger from '@/utils/logger';
import { EventsPublisher } from '@/publishers/events.publisher';
import { ConflictError, NotFoundError } from '@/utils/errors';
import { isTransientError } from '@/utils/transientError';

const inbox = new InboxRepository();
const processed = new ProcessedRepository();
const reservationService = new ReservationService();
const eventsPublisher = new EventsPublisher();

const parse = (msg: ConsumeMessage): OrderCreatedEvent | null => {
  try {
    const payload = JSON.parse(msg.content.toString()) as OrderCreatedEvent;
    if (
      payload.event !== 'order.created' ||
      !payload.event_id ||
      !payload.data?.checkout_id ||
      !payload.data?.expires_at ||
      !Array.isArray(payload.data.items)
    ) {
      return null;
    }
    const expiresAt = new Date(payload.data.expires_at);
    if (Number.isNaN(expiresAt.getTime())) return null;
    if (
      payload.data.items.some(
        (item) =>
          !item.product_id ||
          !item.shop_id ||
          !Number.isFinite(item.qty) ||
          Number(item.qty) <= 0
      )
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const startOrderCreatedConsumer = async () => {
  const channel = await getRabbitChannel();
  await channel.consume(
    rabbitConfig.consume.orderCreated.queue,
    async (msg) => {
      if (!msg) return;
      const payload = parse(msg);
      if (!payload) {
        channel.nack(msg, false, false);
        return;
      }

      try {
        await inbox.trackReceived({
          eventId: payload.event_id,
          event: payload.event,
          routingKey: rabbitConfig.consume.orderCreated.routingKey,
          payload,
          producer: payload.producer,
          correlationId: payload.correlation_id,
          checkoutId: payload.data.checkout_id,
        });

        if (await processed.exists(payload.event_id)) {
          await inbox.markProcessed(payload.event_id).catch(() => undefined);
          channel.ack(msg);
          return;
        }

        await reservationService.reserveStock({
          checkoutId: payload.data.checkout_id,
          orderId: payload.data.order_id ?? undefined,
          correlationId: payload.correlation_id ?? payload.data.checkout_id,
          expiresAt: payload.data.expires_at,
          items: payload.data.items.map((i) => ({
            productId: i.product_id,
            quantity: i.qty,
            shopId: i.shop_id,
          })),
        });

        await processed.markProcessed({
          eventId: payload.event_id,
          event: payload.event,
          producer: payload.producer,
          correlationId: payload.correlation_id,
          checkoutId: payload.data.checkout_id,
        });
        await inbox.markProcessed(payload.event_id);
        channel.ack(msg);
      } catch (error) {
        if (error instanceof ConflictError || error instanceof NotFoundError) {
          const reason = error.message.startsWith('PRODUCT_NOT_FOUND:')
            ? 'PRODUCT_NOT_FOUND'
            : 'OUT_OF_STOCK';
          await eventsPublisher.publishStockRejected({
            checkoutId: payload.data.checkout_id,
            reason,
            correlationId: payload.correlation_id ?? payload.data.checkout_id,
          });
          await processed
            .markProcessed({
              eventId: payload.event_id,
              event: payload.event,
              producer: payload.producer,
              correlationId: payload.correlation_id,
              checkoutId: payload.data.checkout_id,
            })
            .catch(() => undefined);
          await inbox.markProcessed(payload.event_id).catch(() => undefined);
          channel.ack(msg);
          return;
        }
        await inbox
          .markFailed(payload.event_id, error instanceof Error ? error.message : 'failed')
          .catch(() => undefined);
        logger.error({ err: error, event: 'order.created' }, 'consumer failed');
        if (isTransientError(error)) {
          channel.nack(msg, false, true);
          return;
        }
        channel.nack(msg, false, false);
      }
    },
    { noAck: false }
  );
};
