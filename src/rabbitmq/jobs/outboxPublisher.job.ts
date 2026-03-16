import env from '@/config/env';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { OutboxRepository } from '@/repositories/outbox.repository';
import logger from '@/utils/logger';

const outboxRepository = new OutboxRepository();

export const startOutboxPublisherJob = () => {
  setInterval(async () => {
    try {
      const channel = await getRabbitChannel();
      const rows = await outboxRepository.getPending(
        env.OUTBOX_PUBLISH_BATCH_SIZE,
        env.OUTBOX_MAX_ATTEMPTS
      );

      for (const row of rows) {
        try {
          channel.publish(
            rabbitConfig.exchange,
            row.routingKey,
            Buffer.from(JSON.stringify(row.payload)),
            { persistent: true, contentType: 'application/json' }
          );
          await outboxRepository.markPublished(row.id);
        } catch (error) {
          await outboxRepository.markFailed(
            row.id,
            error instanceof Error ? error.message : 'Failed to publish'
          );
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'outbox publisher loop failed');
    }
  }, env.OUTBOX_PUBLISH_INTERVAL_MS);
};
