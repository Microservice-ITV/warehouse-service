import type { InboxStatus, Prisma } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class InboxRepository {
  async trackReceived(input: {
    eventId: string;
    event: string;
    routingKey?: string;
    payload: unknown;
    producer?: string;
    correlationId?: string;
    checkoutId?: string;
  }, db: Db = prisma) {
    return db.inboxEvent.upsert({
      where: { eventId: input.eventId },
      create: {
        eventId: input.eventId,
        event: input.event,
        routingKey: input.routingKey,
        payload: input.payload as Prisma.InputJsonValue,
        producer: input.producer,
        correlationId: input.correlationId,
        checkoutId: input.checkoutId,
        status: 'RECEIVED',
      },
      update: {
        attempts: { increment: 1 },
      },
    });
  }

  async isProcessed(eventId: string, db: Db = prisma) {
    const row = await db.inboxEvent.findUnique({ where: { eventId }, select: { status: true } });
    return row?.status === 'PROCESSED';
  }

  async markProcessed(eventId: string, db: Db = prisma) {
    return db.inboxEvent.update({
      where: { eventId },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  }

  async markFailed(eventId: string, error: string, db: Db = prisma) {
    return db.inboxEvent.update({
      where: { eventId },
      data: {
        status: 'FAILED' satisfies InboxStatus,
        error,
        attempts: { increment: 1 },
      },
    });
  }
}
