import type { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { InboxRepository } from '@/repositories/inbox.repository';
import { ProcessedRepository } from '@/repositories/processed.repository';
import type { ProductUpdatedEvent } from '@/events/types';
import logger from '@/utils/logger';
import { isTransientError } from '@/utils/transientError';
import { ProductSnapshotService } from '@/services/productSnapshot.service';

const inbox = new InboxRepository();
const processed = new ProcessedRepository();
const productSnapshotService = new ProductSnapshotService();

const parse = (msg: ConsumeMessage): ProductUpdatedEvent | null => {
  try {
    const payload = JSON.parse(msg.content.toString()) as ProductUpdatedEvent;
    if (
      payload.event !== 'product.updated' ||
      !payload.event_id ||
      !payload.data?.product_id ||
      !payload.data?.shop_id ||
      !payload.data?.title
    ) {
      return null;
    }
    if (payload.data.price === undefined || !Number.isFinite(Number(payload.data.price))) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const startProductUpdatedConsumer = async () => {
  const channel = await getRabbitChannel();
  await channel.consume(
    rabbitConfig.consume.productUpdated.queue,
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
          routingKey: rabbitConfig.consume.productUpdated.routingKey,
          payload,
          producer: payload.producer,
          correlationId: payload.correlation_id,
        });

        if (await processed.exists(payload.event_id)) {
          await inbox.markProcessed(payload.event_id).catch(() => undefined);
          channel.ack(msg);
          return;
        }

        await productSnapshotService.upsertFromProductEvent(payload.data);

        await processed.markProcessed({
          eventId: payload.event_id,
          event: payload.event,
          producer: payload.producer,
          correlationId: payload.correlation_id,
        });
        await inbox.markProcessed(payload.event_id);
        channel.ack(msg);
      } catch (error) {
        await inbox
          .markFailed(payload.event_id, error instanceof Error ? error.message : 'failed')
          .catch(() => undefined);
        logger.error({ err: error, event: 'product.updated' }, 'consumer failed');
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
