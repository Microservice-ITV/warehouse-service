import { startProductCreatedConsumer } from '@/consumers/productCreated.consumer';
import { startProductDeletedConsumer } from '@/consumers/productDeleted.consumer';
import { startProductUpdatedConsumer } from '@/consumers/productUpdated.consumer';
import { startPurchaseGoodsReceivedConsumer } from '@/consumers/purchaseGoodsReceived.consumer';
import { startStockConfirmedConsumer } from '@/consumers/stockConfirmed.consumer';
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
    await startPurchaseGoodsReceivedConsumer();
    await startStockConfirmedConsumer();
    logger.info('RabbitMQ consumers started');
  } catch (error) {
    logger.error({ err: error }, 'RabbitMQ startup failed');
    throw error;
  }
};
