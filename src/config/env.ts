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
  RABBITMQ_ORDER_CREATED_KEY: z.string().default('order.created'),
  RABBITMQ_ORDER_PAID_KEY: z.string().default('order.paid'),
  RABBITMQ_ORDER_CANCELLED_KEY: z.string().default('order.cancelled'),

  RABBITMQ_PRODUCT_CREATED_QUEUE: z.string().default('warehouse_service.product_created'),
  RABBITMQ_PRODUCT_UPDATED_QUEUE: z.string().default('warehouse_service.product_updated'),
  RABBITMQ_PRODUCT_DELETED_QUEUE: z.string().default('warehouse_service.product_deleted'),
  RABBITMQ_SHOP_CREATED_QUEUE: z.string().default('warehouse_service.shop_created'),
  RABBITMQ_SHOP_UPDATED_QUEUE: z.string().default('warehouse_service.shop_updated'),
  RABBITMQ_SHOP_DELETED_QUEUE: z.string().default('warehouse_service.shop_deleted'),
  RABBITMQ_ORDER_CREATED_QUEUE: z.string().default('warehouse_service.order_created'),
  RABBITMQ_ORDER_PAID_QUEUE: z.string().default('warehouse_service.order_paid'),
  RABBITMQ_ORDER_CANCELLED_QUEUE: z.string().default('warehouse_service.order_cancelled'),

  RABBITMQ_PRODUCT_CREATED_DLQ: z.string().default('warehouse_service.product_created.dlq'),
  RABBITMQ_PRODUCT_UPDATED_DLQ: z.string().default('warehouse_service.product_updated.dlq'),
  RABBITMQ_PRODUCT_DELETED_DLQ: z.string().default('warehouse_service.product_deleted.dlq'),
  RABBITMQ_SHOP_CREATED_DLQ: z.string().default('warehouse_service.shop_created.dlq'),
  RABBITMQ_SHOP_UPDATED_DLQ: z.string().default('warehouse_service.shop_updated.dlq'),
  RABBITMQ_SHOP_DELETED_DLQ: z.string().default('warehouse_service.shop_deleted.dlq'),
  RABBITMQ_ORDER_CREATED_DLQ: z.string().default('warehouse_service.order_created.dlq'),
  RABBITMQ_ORDER_PAID_DLQ: z.string().default('warehouse_service.order_paid.dlq'),
  RABBITMQ_ORDER_CANCELLED_DLQ: z.string().default('warehouse_service.order_cancelled.dlq'),

  RABBITMQ_STOCK_RESERVED_KEY: z.string().default('stock.reserved'),
  RABBITMQ_STOCK_REJECTED_KEY: z.string().default('stock.rejected'),
  RABBITMQ_STOCK_CONFIRMED_KEY: z.string().default('stock.confirmed'),
  RABBITMQ_INVENTORY_UPDATED_KEY: z.string().default('inventory.updated'),

  OUTBOX_PUBLISH_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  OUTBOX_PUBLISH_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),

  RESERVATION_EXPIRY_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  RESERVATION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RESERVATION_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export default env;
