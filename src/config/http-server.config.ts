import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import type { Server } from 'node:http';

import { env } from '@/config/env.config';
import { isDev } from '@/config/env.config';
import { swaggerDocs } from '@/config/docs.config';

import { errorHandler } from '@/middleware/error-handler.middleware';
import { httpLogger } from '@/middleware/http-logger.middleware';

import api_routes from '@/routes/api.routes';
import system_controller from '@/controllers/system.controller';
import { metricsMiddleware } from '@/middleware/metrics.middleware';
import { requestContextMiddleware } from '@/middleware/request-context.middleware';
import { enforceContentType } from '@/middleware/content-type.middleware';
import { methodWhitelist } from '@/middleware/method-whitelist.middleware';
import { requestTimeout } from '@/middleware/request-timeout.middleware';
import { bodyLimitMiddleware } from '@/middleware/request-body-limit.middleware';
import { sanitizeHeaders } from '@/middleware/header-sanitization.middleware';
import { enforceHeaderLimits } from '@/middleware/header-size-limit.middleware';

let instance: Server | null = null;
export function createApp(): express.Express {
  const app = express();

  // Request Context, Metrics, and Logging
  app.use(metricsMiddleware);
  app.use(requestContextMiddleware);
  app.use(httpLogger);

  // Rate Limiting (global protection against flooding)
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: isDev ? 1000 : 200,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      statusCode: 429,
      message: {
        status: 429,
        message: 'Too many requests — please slow down.',
        timestamp: Date.now(),
      },
    }),
  );

  app.set('trust proxy', 1);

  app.use(sanitizeHeaders());
  app.use(enforceHeaderLimits());

  // Request Timeouts and Body Enforcement
  app.use(
    requestTimeout({
      headerTimeout: 5_000,
      chunkTimeout: 2_000,
      totalTimeout: 10_000,
    }),
  );

  app.use(
    bodyLimitMiddleware({
      defaultLimit: 1_048_576,
      routeOverrides: [],
    }),
  );

  // Protocol & Semantics Enforcement
  app.use(
    enforceContentType({
      defaultAllowed: new Set(['application/json', 'multipart/form-data']),
      routeOverrides: [],
    }),
  );

  app.use(
    methodWhitelist({
      allowedMethods: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    }),
  );

  // Request Parsing (JSON, URL-encoded) + Compression
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(compression());

  // CORS and Security Headers
  app.use(
    cors({
      origin: ['*'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Routes
  app.use('/', system_controller);
  app.use('/api', api_routes);

  // Documentation Routes (Swagger)
  app.use('/docs', ...swaggerDocs);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}

export const registerServer = async (): Promise<void> => {
  if (instance) return;

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0');

  instance = server;
};

export const closeServer = (): void => {
  if (!instance) return;

  instance.close();
};

export const isServerRunning = (): boolean => {
  return instance !== null;
};
