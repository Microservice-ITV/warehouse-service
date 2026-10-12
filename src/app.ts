import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import env from '@/config/env';
import logger from '@/utils/logger';
import routes from '@/routes';
import { errorHandler } from '@/middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    }, 'http request');
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Warehouse Service is running',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1', routes);
app.use(errorHandler);

export default app;
