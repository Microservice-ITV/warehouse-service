import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5010),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(16).optional(),
  SERVICE_API_KEY: z.string().min(8),
  /** Base URL for product-service API (used to credit shop stock after warehouse receive). */
  PRODUCT_SERVICE_URL: z
    .string()
    .url()
    .default('http://product-service-dev:5001/api/v1'),

  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().default('order_events'),
  RABBITMQ_DLX: z.string().default('order_events.dlx'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(20),

  RABBITMQ_PRODUCT_CREATED_KEY: z.string().default('product.created'),
  RABBITMQ_PRODUCT_UPDATED_KEY: z.string().default('product.updated'),
  RABBITMQ_PRODUCT_DELETED_KEY: z.string().default('product.deleted'),
  RABBITMQ_SHOP_CREATED_KEY: z.string().default('shop.created'),
  RABBITMQ_SHOP_UPDATED_KEY: z.string().default('shop.updated'),
  RABBITMQ_SHOP_DELETED_KEY: z.string().default('shop.deleted'),

  RABBITMQ_PRODUCT_CREATED_QUEUE: z.string().default('warehouse_service.product_created'),
  RABBITMQ_PRODUCT_UPDATED_QUEUE: z.string().default('warehouse_service.product_updated'),
  RABBITMQ_PRODUCT_DELETED_QUEUE: z.string().default('warehouse_service.product_deleted'),
  RABBITMQ_SHOP_CREATED_QUEUE: z.string().default('warehouse_service.shop_created'),
  RABBITMQ_SHOP_UPDATED_QUEUE: z.string().default('warehouse_service.shop_updated'),
  RABBITMQ_SHOP_DELETED_QUEUE: z.string().default('warehouse_service.shop_deleted'),

  RABBITMQ_PRODUCT_CREATED_DLQ: z.string().default('warehouse_service.product_created.dlq'),
  RABBITMQ_PRODUCT_UPDATED_DLQ: z.string().default('warehouse_service.product_updated.dlq'),
  RABBITMQ_PRODUCT_DELETED_DLQ: z.string().default('warehouse_service.product_deleted.dlq'),
  RABBITMQ_SHOP_CREATED_DLQ: z.string().default('warehouse_service.shop_created.dlq'),
  RABBITMQ_SHOP_UPDATED_DLQ: z.string().default('warehouse_service.shop_updated.dlq'),
  RABBITMQ_SHOP_DELETED_DLQ: z.string().default('warehouse_service.shop_deleted.dlq'),

  RABBITMQ_INVENTORY_UPDATED_KEY: z.string().default('inventory.updated'),
  RABBITMQ_INVENTORY_LOW_STOCK_KEY: z.string().default('inventory.low_stock'),

  RABBITMQ_PURCHASE_GOODS_RECEIVED_KEY: z.string().default('purchase.goods_received'),
  RABBITMQ_PURCHASE_GOODS_RECEIVED_QUEUE: z
    .string()
    .default('warehouse_service.purchase_goods_received'),
  RABBITMQ_PURCHASE_GOODS_RECEIVED_DLQ: z
    .string()
    .default('warehouse_service.purchase_goods_received.dlq'),

  RABBITMQ_STOCK_CONFIRMED_KEY: z.string().default('product.stock.confirmed'),
  RABBITMQ_STOCK_CONFIRMED_QUEUE: z.string().default('warehouse_service.stock_confirmed'),
  RABBITMQ_STOCK_CONFIRMED_DLQ: z.string().default('warehouse_service.stock_confirmed.dlq'),

  LOW_STOCK_THRESHOLD: z.coerce.number().int().min(0).default(5),

  OUTBOX_PUBLISH_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  OUTBOX_PUBLISH_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),

});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export default env;
