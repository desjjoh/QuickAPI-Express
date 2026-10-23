import express from 'express';
import path from 'node:path';
import type { Server } from 'node:http';

import { env, type Env } from '@/config/env.config';
import { docsJson, redocDocs, swaggerDocs } from '@/config/docs.config';

import api_routes from '@/api/api.routes';

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

const publicDirectory = path.resolve(process.cwd(), 'public');
const faviconPath = path.join(publicDirectory, 'favicon.ico');

type HttpPolicy = Pick<
  Env,
  | 'TRUST_PROXY'
  | 'CORS_ORIGINS'
  | 'CORS_METHODS'
  | 'CORS_ALLOWED_HEADERS'
  | 'CORS_EXPOSED_HEADERS'
  | 'CORS_CREDENTIALS'
  | 'CORS_MAX_AGE_SECONDS'
>;

export function createApp(policy: HttpPolicy = env): express.Express {
  const app = express();

  app.set(
    'trust proxy',
    policy.TRUST_PROXY.length ? policy.TRUST_PROXY : false,
  );
  app.disable('x-powered-by');

  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(faviconPath);
  });

  app.use(express.static(publicDirectory));

  app.use(metricsMiddleware);
  app.use(requestContextMiddleware);
  app.use(httpLogger);

  app.use(securityHeaders);

  app.use(
    createRateLimitMiddleware({
      windowMs: 60_000,
      max: 200,
      keyGenerator: (req) => req.ip ?? 'unknown',
    }),
  );

  app.use(sanitizeHeaders(policy.CORS_ALLOWED_HEADERS));
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
      allowedMethods: new Set([
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS',
      ]),
    }),
  );

  app.use(
    createCorsMiddleware({
      origin: policy.CORS_ORIGINS,
      methods: policy.CORS_METHODS,
      allowedHeaders: policy.CORS_ALLOWED_HEADERS,
      exposedHeaders: policy.CORS_EXPOSED_HEADERS,
      credentials: policy.CORS_CREDENTIALS,
      maxAge: policy.CORS_MAX_AGE_SECONDS,
    }),
  );

  app.use(
    bodyLimitMiddleware({
      defaultLimit: 1_048_576,
      routeOverrides: [],
    }),
  );

  app.use('/', api_routes);

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

export const closeServer = async (): Promise<void> => {
  if (!instance) return;

  const server = instance;

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (instance === server) instance = null;
      if (err) reject(err);
      else resolve();
    });
  });
};

export const isServerRunning = (): boolean => {
  return instance !== null;
};
