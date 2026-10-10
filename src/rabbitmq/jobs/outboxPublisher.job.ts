import type { OutboxEvent } from '@prisma/client';
import env from '@/config/env';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { OutboxRepository } from '@/repositories/outbox.repository';
import { PurchaseOutboxRepository } from '@/repositories/purchaseOutbox.repository';
import logger from '@/utils/logger';

const outboxRepository = new OutboxRepository();
const purchaseOutboxRepository = new PurchaseOutboxRepository();

const publishRows = async (
  rows: OutboxEvent[],
  markPublished: (id: string) => Promise<unknown>,
  markFailed: (id: string, message: string) => Promise<unknown>
) => {
  const channel = await getRabbitChannel();
  for (const row of rows) {
    try {
      channel.publish(
        rabbitConfig.exchange,
        row.routingKey,
        Buffer.from(JSON.stringify(row.payload)),
        { persistent: true, contentType: 'application/json' }
      );
      await markPublished(row.id);
    } catch (error) {
      await markFailed(row.id, error instanceof Error ? error.message : 'Failed to publish');
    }
  }
};

export const startOutboxPublisherJob = () => {
  setInterval(async () => {
    try {
      const [rows, purchaseRows] = await Promise.all([
        outboxRepository.getPending(env.OUTBOX_PUBLISH_BATCH_SIZE, env.OUTBOX_MAX_ATTEMPTS),
        purchaseOutboxRepository.getPending(
          env.OUTBOX_PUBLISH_BATCH_SIZE,
          env.OUTBOX_MAX_ATTEMPTS
        ),
      ]);

      if (rows.length > 0) {
        await publishRows(
          rows,
          (id) => outboxRepository.markPublished(id),
          (id, message) => outboxRepository.markFailed(id, message)
        );
      }

      if (purchaseRows.length > 0) {
        await publishRows(
          purchaseRows,
          (id) => purchaseOutboxRepository.markPublished(id),
          (id, message) => purchaseOutboxRepository.markFailed(id, message)
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown outbox publisher error';
      logger.error({ err: error, message }, 'outbox publisher loop failed');
    }
  }, env.OUTBOX_PUBLISH_INTERVAL_MS);
};