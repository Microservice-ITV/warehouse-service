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
    orderCreated: {
      routingKey: env.RABBITMQ_ORDER_CREATED_KEY,
      queue: env.RABBITMQ_ORDER_CREATED_QUEUE,
      dlq: env.RABBITMQ_ORDER_CREATED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_ORDER_CREATED_KEY}.dlq`,
    },
    orderPaid: {
      routingKey: env.RABBITMQ_ORDER_PAID_KEY,
      queue: env.RABBITMQ_ORDER_PAID_QUEUE,
      dlq: env.RABBITMQ_ORDER_PAID_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_ORDER_PAID_KEY}.dlq`,
    },
    orderCancelled: {
      routingKey: env.RABBITMQ_ORDER_CANCELLED_KEY,
      queue: env.RABBITMQ_ORDER_CANCELLED_QUEUE,
      dlq: env.RABBITMQ_ORDER_CANCELLED_DLQ,
      dlqRoutingKey: `${env.RABBITMQ_ORDER_CANCELLED_KEY}.dlq`,
    },
  },
  publish: {
    stockReserved: env.RABBITMQ_STOCK_RESERVED_KEY,
    stockRejected: env.RABBITMQ_STOCK_REJECTED_KEY,
    stockConfirmed: env.RABBITMQ_STOCK_CONFIRMED_KEY,
    inventoryUpdated: env.RABBITMQ_INVENTORY_UPDATED_KEY,
  },
};
