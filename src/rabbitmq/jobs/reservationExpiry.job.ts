import env from '@/config/env';
import logger from '@/utils/logger';
import { ReservationService } from '@/services/reservation.service';

const reservationService = new ReservationService();

const processExpiredReservations = async () => {
  const expiredCount = await reservationService.expireReservations();
  if (expiredCount > 0) {
    logger.info({ expiredCount }, 'Expired stock reservations released');
  }
};

export const startReservationExpiryJob = () => {
  const intervalMs = env.RESERVATION_EXPIRY_INTERVAL_SECONDS * 1000;

  setInterval(() => {
    processExpiredReservations().catch((error) => {
      logger.error({ err: error }, 'Failed to process expired reservations');
    });
  }, intervalMs);

  logger.info(
    { intervalSeconds: env.RESERVATION_EXPIRY_INTERVAL_SECONDS },
    'Reservation expiry job started'
  );
};
