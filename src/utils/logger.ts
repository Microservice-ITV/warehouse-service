import fs from 'fs';
import path from 'path';
import winston from 'winston';
import env from '@/config/env';

const logsDir = path.resolve(process.cwd(), 'logs');
const centralizedDir = path.resolve(__dirname, '..', '..', '..', '..', 'logs');
for (const dir of [logsDir, centralizedDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const serviceName = 'warehouse-service';
const baseLogger = winston.createLogger({
  level: env.LOG_LEVEL,
  silent: env.LOG_LEVEL === 'silent',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: serviceName },
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logsDir, 'combined.log') }),
    new winston.transports.File({ filename: path.join(centralizedDir, `${serviceName}.log`), level: 'error' }),
    new winston.transports.File({ filename: path.join(centralizedDir, `${serviceName}-combined.log`) }),
  ],
});

if (env.NODE_ENV !== 'production') {
  baseLogger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(
          ({ timestamp, level, message, ...meta }) =>
            `${timestamp} [${level}]: ${message} ${
              Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
            }`
        )
      ),
    })
  );
}

const normalizeArgs = (args: unknown[]) => {
  if (args.length === 0) return { message: '', meta: {} as Record<string, unknown> };

  if (typeof args[0] === 'string') {
    const [message, meta] = args;
    return {
      message,
      meta: meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {},
    };
  }

  if (args[0] && typeof args[0] === 'object') {
    const [meta, message] = args;
    return {
      message: typeof message === 'string' ? message : '',
      meta: meta as Record<string, unknown>,
    };
  }

  return { message: String(args[0]), meta: {} as Record<string, unknown> };
};

const write = (level: 'error' | 'warn' | 'info' | 'debug', ...args: unknown[]) => {
  const { message, meta } = normalizeArgs(args);
  baseLogger.log(level, message || level, meta);
};

const logger = {
  error: (...args: unknown[]) => write('error', ...args),
  warn: (...args: unknown[]) => write('warn', ...args),
  info: (...args: unknown[]) => write('info', ...args),
  debug: (...args: unknown[]) => write('debug', ...args),
};

export default logger;

