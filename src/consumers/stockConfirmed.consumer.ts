import type { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { InboxRepository } from '@/repositories/inbox.repository';
import { ProcessedRepository } from '@/repositories/processed.repository';
import type { StockConfirmedEvent } from '@/events/types';
import { InventoryService } from '@/services/inventory.service';
import logger from '@/utils/logger';
import { isTransientError } from '@/utils/transientError';

const inbox = new InboxRepository();
const processed = new ProcessedRepository();
const inventoryService = new InventoryService();

const parse = (msg: ConsumeMessage): StockConfirmedEvent | null => {
  try {
    const payload = JSON.parse(msg.content.toString()) as StockConfirmedEvent;
    if (payload.event !== 'product.stock.confirmed' || !payload.event_id) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const startStockConfirmedConsumer = async () => {
  const channel = await getRabbitChannel();
  await channel.consume(
    rabbitConfig.consume.stockConfirmed.queue,
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
          routingKey: rabbitConfig.consume.stockConfirmed.routingKey,
          payload,
          producer: payload.producer,
          correlationId: payload.correlation_id,
        });

        if (await processed.exists(payload.event_id)) {
          await inbox.markProcessed(payload.event_id).catch(() => undefined);
          channel.ack(msg);
          return;
        }

        const items = payload.data.items ?? [];
        const referenceId =
          payload.data.order_id || payload.data.checkout_id || payload.event_id;

        for (const item of items) {
          const quantity = Number(item.quantity);
          if (!item.product_id || !Number.isFinite(quantity) || quantity <= 0) continue;
          await inventoryService.issueCustomerSale({
            productId: item.product_id,
            quantity,
            variantId: item.variant_id,
            colorId: item.color_id,
            sizeId: item.size_id,
            referenceId,
          });
        }

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
        logger.error({ err: error, event: 'product.stock.confirmed' }, 'consumer failed');
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
