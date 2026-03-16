import app from '@/app';
import prisma from '@/config/database';
import env from '@/config/env';
import logger from '@/utils/logger';
import { startRabbitMQ } from '@/rabbitmq';
import { startOutboxPublisherJob } from '@/rabbitmq/jobs/outboxPublisher.job';
import { startReservationCleanupJob } from '@/rabbitmq/jobs/reservationCleanup.job';
import { startReservationExpiryJob } from '@/rabbitmq/jobs/reservationExpiry.job';
import { closeRabbitConnection } from '@/rabbitmq/connection';

const bootstrap = async () => {
  await prisma.$connect();
  logger.info('Database connected');

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'warehouse-service started');
  });

  await startRabbitMQ();
  startOutboxPublisherJob();
  startReservationExpiryJob();
  startReservationCleanupJob();
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
