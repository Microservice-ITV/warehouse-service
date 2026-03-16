import type { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { InboxRepository } from '@/repositories/inbox.repository';
import { ProcessedRepository } from '@/repositories/processed.repository';
import { ReservationService } from '@/services/reservation.service';
import type { OrderCancelledEvent } from '@/events/types';
import logger from '@/utils/logger';
import { isTransientError } from '@/utils/transientError';

const inbox = new InboxRepository();
const processed = new ProcessedRepository();
const reservationService = new ReservationService();

const parse = (msg: ConsumeMessage): OrderCancelledEvent | null => {
  try {
    const payload = JSON.parse(msg.content.toString()) as OrderCancelledEvent;
    if (
      payload.event !== 'order.cancelled' ||
      !payload.event_id ||
      !payload.data?.checkout_id
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const startOrderCancelledConsumer = async () => {
  const channel = await getRabbitChannel();
  await channel.consume(
    rabbitConfig.consume.orderCancelled.queue,
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
          routingKey: rabbitConfig.consume.orderCancelled.routingKey,
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

        await reservationService.releaseReservation({
          checkoutId: payload.data.checkout_id,
          reservationId: payload.data.reservation_id,
          correlationId: payload.correlation_id ?? payload.data.checkout_id,
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
        await inbox
          .markFailed(payload.event_id, error instanceof Error ? error.message : 'failed')
          .catch(() => undefined);
        logger.error({ err: error, event: 'order.cancelled' }, 'consumer failed');
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
