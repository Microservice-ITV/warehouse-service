import env from './env';

export const rabbitConfig = {
  url: env.RABBITMQ_URL,
  exchange: env.RABBITMQ_EXCHANGE,
  exchangeType: 'topic' as const,
  deadLetterExchange: env.RABBITMQ_DLX,
  prefetch: env.RABBITMQ_PREFETCH,

  consume: {
    productCreated: {
      routingKey: env.RABBITMQ_PRODUCT_CREATED_KEY,
      queue: env.RABBITMQ_PRODUCT_CREATED_QUEUE,
      dlq: env.RABBITMQ_PRODUCT_CREATED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_PRODUCT_CREATED_KEY}.dlq`,
    },
    productUpdated: {
      routingKey: env.RABBITMQ_PRODUCT_UPDATED_KEY,
      queue: env.RABBITMQ_PRODUCT_UPDATED_QUEUE,
      dlq: env.RABBITMQ_PRODUCT_UPDATED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_PRODUCT_UPDATED_KEY}.dlq`,
    },
    productDeleted: {
      routingKey: env.RABBITMQ_PRODUCT_DELETED_KEY,
      queue: env.RABBITMQ_PRODUCT_DELETED_QUEUE,
      dlq: env.RABBITMQ_PRODUCT_DELETED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_PRODUCT_DELETED_KEY}.dlq`,
    },
    shopCreated: {
      routingKey: env.RABBITMQ_SHOP_CREATED_KEY,
      queue: env.RABBITMQ_SHOP_CREATED_QUEUE,
      dlq: env.RABBITMQ_SHOP_CREATED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_SHOP_CREATED_KEY}.dlq`,
    },
    shopUpdated: {
      routingKey: env.RABBITMQ_SHOP_UPDATED_KEY,
      queue: env.RABBITMQ_SHOP_UPDATED_QUEUE,
      dlq: env.RABBITMQ_SHOP_UPDATED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_SHOP_UPDATED_KEY}.dlq`,
    },
    shopDeleted: {
      routingKey: env.RABBITMQ_SHOP_DELETED_KEY,
      queue: env.RABBITMQ_SHOP_DELETED_QUEUE,
      dlq: env.RABBITMQ_SHOP_DELETED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_SHOP_DELETED_KEY}.dlq`,
    },
    purchaseGoodsReceived: {
      routingKey: env.RABBITMQ_PURCHASE_GOODS_RECEIVED_KEY,
      queue: env.RABBITMQ_PURCHASE_GOODS_RECEIVED_QUEUE,
      dlq: env.RABBITMQ_PURCHASE_GOODS_RECEIVED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_PURCHASE_GOODS_RECEIVED_KEY}.dlq`,
    },
  },
  publish: {
    inventoryUpdated: env.RABBITMQ_INVENTORY_UPDATED_KEY,
    inventoryLowStock: env.RABBITMQ_INVENTORY_LOW_STOCK_KEY,
    purchaseGoodsReceived: env.RABBITMQ_PURCHASE_GOODS_RECEIVED_KEY,
    purchaseGoodsReturned: 'purchase.goods_returned',
  },
};
