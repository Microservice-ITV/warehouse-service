import type { ConsumeMessage } from 'amqplib';
import { getRabbitChannel } from '@/rabbitmq/connection';
import { rabbitConfig } from '@/config/rabbitmq';
import { InboxRepository } from '@/repositories/inbox.repository';
import { ProcessedRepository } from '@/repositories/processed.repository';
import type { PurchaseGoodsReceivedEvent } from '@/events/types';
import { InventoryService } from '@/services/inventory.service';
import logger from '@/utils/logger';
import { isTransientError } from '@/utils/transientError';

const inbox = new InboxRepository();
const processed = new ProcessedRepository();
const inventoryService = new InventoryService();

const parse = (msg: ConsumeMessage): PurchaseGoodsReceivedEvent | null => {
  try {
    const payload = JSON.parse(msg.content.toString()) as PurchaseGoodsReceivedEvent;
    if (
      payload.event !== 'purchase.goods_received' ||
      !payload.event_id ||
      !payload.data?.receipt_id ||
      !payload.data?.warehouse_id ||
      !Array.isArray(payload.data.items) ||
      payload.data.items.length === 0
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const startPurchaseGoodsReceivedConsumer = async () => {
  const channel = await getRabbitChannel();
  await channel.consume(
    rabbitConfig.consume.purchaseGoodsReceived.queue,
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
          routingKey: rabbitConfig.consume.purchaseGoodsReceived.routingKey,
          payload,
          producer: payload.producer,
          correlationId: payload.correlation_id,
        });

        if (await processed.exists(payload.event_id)) {
          await inbox.markProcessed(payload.event_id).catch(() => undefined);
          channel.ack(msg);
          return;
        }

        await inventoryService.receivePurchaseGoods({
          receiptId: payload.data.receipt_id,
          receiptNumber: payload.data.receipt_number,
          warehouseId: payload.data.warehouse_id,
          supplierId: payload.data.supplier_id ?? undefined,
          items: payload.data.items.map((item) => ({
            productId: item.product_id,
            variantId: item.variant_id,
            quantity: Number(item.quantity),
            unitCost: Number(item.unit_cost),
          })),
        });

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
        logger.error({ err: error, event: 'purchase.goods_received' }, 'consumer failed');
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