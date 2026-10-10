import app from '@/app';
import prisma from '@/config/database';
import env from '@/config/env';
import logger from '@/utils/logger';
import { startRabbitMQ } from '@/rabbitmq';
import { startOutboxPublisherJob } from '@/rabbitmq/jobs/outboxPublisher.job';
import { closeRabbitConnection } from '@/rabbitmq/connection';

const RABBIT_RETRY_BASE_MS = 5000;
const RABBIT_RETRY_MAX_MS = 30000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const startRabbitWithRetry = async (): Promise<void> => {
  let attempt = 0;
  let delayMs = RABBIT_RETRY_BASE_MS;
  let connected = false;

  while (!connected) {
    attempt += 1;
    try {
      await startRabbitMQ();
      startOutboxPublisherJob();
      connected = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      logger.warn(
        { err: error, attempt, retryInMs: delayMs },
        `RabbitMQ unavailable (${message}), retrying...`
      );
      await delay(delayMs);
      delayMs = Math.min(delayMs * 2, RABBIT_RETRY_MAX_MS);
    }
  }
};

const bootstrap = async (): Promise<void> => {
  await prisma.$connect();
  logger.info('Database connected');

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'warehouse-service started');
  });

  await startRabbitWithRetry();
};

bootstrap().catch((error) => {
  logger.error({ err: error }, 'bootstrap failed');
  process.exit(1);
});

const shutdown = async () => {
  await closeRabbitConnection().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
