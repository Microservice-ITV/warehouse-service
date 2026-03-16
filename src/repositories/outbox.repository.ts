import type { OutboxEvent, OutboxStatus, Prisma } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class OutboxRepository {
  async enqueue(params: {
    eventId: string;
    event: string;
    routingKey: string;
    payload: unknown;
    db?: Db;
  }) {
    const db = params.db ?? prisma;
    return db.outboxEvent.create({
      data: {
        eventId: params.eventId,
        event: params.event,
        routingKey: params.routingKey,
        payload: params.payload as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });
  }

  async getPending(batchSize: number, maxAttempts: number): Promise<OutboxEvent[]> {
    return prisma.outboxEvent.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: maxAttempts },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
  }

  async markPublished(id: string) {
    return prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        error: null,
      },
    });
  }

  async markFailed(id: string, error: string, status: OutboxStatus = 'FAILED') {
    return prisma.outboxEvent.update({
      where: { id },
      data: {
        status,
        attempts: { increment: 1 },
        error,
      },
    });
  }
}
