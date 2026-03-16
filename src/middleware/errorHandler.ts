import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@/utils/errors';
import logger from '@/utils/logger';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (error instanceof AppError) {
    logger.warn(
      {
        err: error,
        path: req.path,
        method: req.method,
      },
      'request failed'
    );
    return res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
  }

  logger.error({ err: error, path: req.path, method: req.method }, 'unexpected error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
};
