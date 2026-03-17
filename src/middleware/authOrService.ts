import type { NextFunction, Request, Response } from 'express';
import env from '@/config/env';
import { authenticate } from '@/middleware/auth';

export const authOrService = (req: Request, res: Response, next: NextFunction) => {
  const key = req.header('x-service-key');
  if (key && key === env.SERVICE_API_KEY) {
    return next();
  }
  return authenticate(req, res, next);
};
