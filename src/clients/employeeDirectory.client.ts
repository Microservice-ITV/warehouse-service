import env from '@/config/env';
import { AppError } from '@/utils/errors';
import logger from '@/utils/logger';

export type WarehouseManagerOption = {
  id: string;
  name: string;
  email: string | null;
};

type EmployeeDirectoryResponse = {
  success?: boolean;
  data?: { users?: WarehouseManagerOption[] };
};

export async function listWarehouseManagers(): Promise<WarehouseManagerOption[]> {
  const url = `${env.EMPLOYEE_SERVICE_URL.replace(/\/$/, '')}/internal/warehouse-managers`;

  try {
    const response = await fetch(url, {
      headers: { 'X-Internal-Service-Key': env.EMPLOYEE_SERVICE_KEY },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error({ url, status: response.status }, 'Employee service manager lookup failed');
      if (response.status === 401) {
        throw new AppError(
          'Employee service rejected warehouse-manager lookup authentication. Verify EMPLOYEE_SERVICE_KEY matches employee-service INTERNAL_SERVICE_KEY.',
          502,
        );
      }
      if (response.status === 503) {
        throw new AppError(
          'Employee service internal API is not configured. Check employee-service INTERNAL_SERVICE_KEY.',
          502,
        );
      }
      throw new AppError(`Employee service manager lookup failed (${response.status})`, 502);
    }

    const payload = (await response.json()) as EmployeeDirectoryResponse;
    const users = payload.data?.users;
    if (!payload.success || !Array.isArray(users)) {
      logger.error({ url }, 'Employee service returned an invalid warehouse manager list');
      throw new AppError('Employee service returned an invalid warehouse manager list', 502);
    }

    return users;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ err: error, url }, 'Employee service manager lookup request failed');
    throw new AppError(
      'Could not reach employee service to load warehouse managers. Check EMPLOYEE_SERVICE_URL and service network connectivity.',
      502,
    );
  }
}
