import env from '@/config/env';
import logger from '@/utils/logger';
import { ReservationService } from '@/services/reservation.service';

const reservationService = new ReservationService();

const purgeExpiredReservations = async () => {
  const retentionMs = env.RESERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs);
  const result = await reservationService.cleanupExpiredReservations(cutoff);

  if (result.count > 0) {
    logger.info({ count: result.count, cutoff: cutoff.toISOString() }, 'Purged old reservations');
  }
};

export const startReservationCleanupJob = () => {
  const intervalMs = env.RESERVATION_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;

  setInterval(() => {
    purgeExpiredReservations().catch((error) => {
      logger.error({ err: error }, 'Failed to purge old reservations');
    });
  }, intervalMs);

  logger.info(
    {
      intervalHours: env.RESERVATION_CLEANUP_INTERVAL_HOURS,
      retentionDays: env.RESERVATION_RETENTION_DAYS,
    },
    'Reservation cleanup job started'
  );
};
