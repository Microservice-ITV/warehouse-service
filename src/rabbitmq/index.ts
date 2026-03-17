import { startOrderCancelledConsumer } from '@/consumers/orderCancelled.consumer';
import { startOrderCreatedConsumer } from '@/consumers/orderCreated.consumer';
import { startOrderPaidConsumer } from '@/consumers/orderPaid.consumer';
import { startProductCreatedConsumer } from '@/consumers/productCreated.consumer';
import { startProductDeletedConsumer } from '@/consumers/productDeleted.consumer';
import { startProductUpdatedConsumer } from '@/consumers/productUpdated.consumer';
import { startShopCreatedConsumer } from '@/consumers/shopCreated.consumer';
import { startShopDeletedConsumer } from '@/consumers/shopDeleted.consumer';
import { startShopUpdatedConsumer } from '@/consumers/shopUpdated.consumer';
import logger from '@/utils/logger';

export const startRabbitMQ = async () => {
  try {
    await startProductCreatedConsumer();
    await startProductUpdatedConsumer();
    await startProductDeletedConsumer();
    await startShopCreatedConsumer();
    await startShopUpdatedConsumer();
    await startShopDeletedConsumer();
    await startOrderCreatedConsumer();
    await startOrderPaidConsumer();
    await startOrderCancelledConsumer();
    logger.info('RabbitMQ consumers started');
  } catch (error) {
    logger.error({ err: error }, 'RabbitMQ startup failed');
    throw error;
  }
};
