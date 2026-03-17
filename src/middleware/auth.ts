import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import env from '@/config/env';
import { AppError } from '@/utils/errors';

export interface AuthPayload extends JwtPayload {
  sub?: string;
  userId?: string;
  email?: string;
  role?: string;
}

const BEARER_PREFIX = 'Bearer ';

export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return next(new AppError('Authorization header missing or malformed', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    return next(new AppError('Authorization token missing', 401, 'UNAUTHORIZED'));
  }

  if (!env.JWT_SECRET) {
    return next(new AppError('JWT authentication is not configured', 500, 'AUTH_CONFIG_ERROR'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthPayload | string;
    if (typeof decoded === 'string') {
      req.user = { sub: decoded };
    } else {
      req.user = decoded;
    }
    return next();
  } catch {
    return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
  }
};
