import express from 'express';

import type { Server } from 'node:http';

import { env } from '@/config/env.config';
import { docsJson, redocDocs, swaggerDocs } from '@/config/docs.config';

import api_routes from '@/application/api/api.routes';
import system_controller from '@/application/system/controllers/system.controller';

import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { httpLogger } from '@/common/middleware/http-logger.middleware';
import { metricsMiddleware } from '@/common/middleware/metrics.middleware';
import { requestContextMiddleware } from '@/common/middleware/request-context.middleware';
import { enforceContentType } from '@/common/middleware/content-type.middleware';
import { methodWhitelist } from '@/common/middleware/method-whitelist.middleware';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { bodyLimitMiddleware } from '@/common/middleware/request-body-limit.middleware';
import { sanitizeHeaders } from '@/common/middleware/header-sanitization.middleware';
import { enforceHeaderLimits } from '@/common/middleware/header-size-limit.middleware';
import { securityHeaders } from '@/common/middleware/security-headers.middleware';
import { createCorsMiddleware } from '@/common/middleware/cors.middleware';
import { createRateLimitMiddleware } from '@/common/middleware/rate-limit.middleware';

import { not_found } from '@/common/routes/not-found.route';

let instance: Server | null = null;

export function createApp(): express.Express {
  const app = express();

  app.use(metricsMiddleware);
  app.use(requestContextMiddleware);
  app.use(httpLogger);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    createRateLimitMiddleware({
      windowMs: 60_000,
      max: 200,
      keyGenerator: req => req.ip ?? 'unknown',
    }),
  );

  app.use(sanitizeHeaders());
  app.use(enforceHeaderLimits());

  app.use(
    requestTimeout({
      headerTimeout: 5_000,
      chunkTimeout: 2_000,
      totalTimeout: 10_000,
    }),
  );

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

  app.use(
    createCorsMiddleware({
      origin: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-requested-with'],
      exposedHeaders: ['authorization', 'set-cookie'],
      credentials: true,
      maxAge: 86_400,
    }),
  );

  app.use(securityHeaders);

  app.use(
    bodyLimitMiddleware({
      defaultLimit: 1_048_576,
      routeOverrides: [],
    }),
  );

  app.use(express.json());

  app.use('/', system_controller);
  app.use('/api', api_routes);

  app.use('/docs', ...swaggerDocs);
  app.get('/docs-json', docsJson);
  app.get('/redoc', redocDocs);

  app.use(not_found);
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
