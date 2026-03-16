import type { NextFunction, Request, Response } from 'express';
import env from '@/config/env';
import { AppError } from '@/utils/errors';

export const serviceAuth = (req: Request, _res: Response, next: NextFunction) => {
  const key = req.header('x-service-key');
  if (!key || key !== env.SERVICE_API_KEY) {
    return next(new AppError('Unauthorized service request', 401, 'UNAUTHORIZED'));
  }
  return next();
};
