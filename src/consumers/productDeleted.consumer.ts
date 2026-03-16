import type { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { InboxRepository } from '@/repositories/inbox.repository';
import { ProcessedRepository } from '@/repositories/processed.repository';
import type { ProductDeletedEvent } from '@/events/types';
import logger from '@/utils/logger';
import { isTransientError } from '@/utils/transientError';
import { ProductSnapshotService } from '@/services/productSnapshot.service';

const inbox = new InboxRepository();
const processed = new ProcessedRepository();
const productSnapshotService = new ProductSnapshotService();

const parse = (msg: ConsumeMessage): ProductDeletedEvent | null => {
  try {
    const payload = JSON.parse(msg.content.toString()) as ProductDeletedEvent;
    if (payload.event !== 'product.deleted' || !payload.event_id || !payload.data?.product_id) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const startProductDeletedConsumer = async () => {
  const channel = await getRabbitChannel();
  await channel.consume(
    rabbitConfig.consume.productDeleted.queue,
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
          routingKey: rabbitConfig.consume.productDeleted.routingKey,
          payload,
          producer: payload.producer,
          correlationId: payload.correlation_id,
        });

        if (await processed.exists(payload.event_id)) {
          await inbox.markProcessed(payload.event_id).catch(() => undefined);
          channel.ack(msg);
          return;
        }

        await productSnapshotService.markDeleted(payload.data.product_id);

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
        logger.error({ err: error, event: 'product.deleted' }, 'consumer failed');
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
