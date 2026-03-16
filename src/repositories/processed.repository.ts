import type { Prisma } from '@prisma/client';
import prisma from '@/config/database';

type Db = Prisma.TransactionClient | typeof prisma;

export class ProcessedRepository {
  async exists(eventId: string, db: Db = prisma): Promise<boolean> {
    const row = await db.processedEvent.findUnique({
      where: { eventId },
      select: { id: true },
    });
    return Boolean(row);
  }

  async markProcessed(
    input: {
      eventId: string;
      event: string;
      producer?: string;
      correlationId?: string;
      checkoutId?: string;
    },
    db: Db = prisma
  ) {
    return db.processedEvent.upsert({
      where: { eventId: input.eventId },
      update: {
        event: input.event,
        producer: input.producer,
        correlationId: input.correlationId,
        checkoutId: input.checkoutId,
        processedAt: new Date(),
      },
      create: {
        eventId: input.eventId,
        event: input.event,
        producer: input.producer,
        correlationId: input.correlationId,
        checkoutId: input.checkoutId,
      },
    });
  }
}
