import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@/utils/errors';
import logger from '@/utils/logger';

const unwrapAppError = (error: unknown): AppError | null => {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (current instanceof AppError) return current;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return null;
};

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const appError = error instanceof AppError ? error : unwrapAppError(error);
  if (appError) {
    logger.warn(
      {
        err: error,
        path: req.path,
        method: req.method,
      },
      'request failed'
    );
    return res.status(appError.statusCode).json({
      success: false,
      error: { code: appError.code, message: appError.message },
    });
  }

  logger.error({ err: error, path: req.path, method: req.method }, 'unexpected error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
};
