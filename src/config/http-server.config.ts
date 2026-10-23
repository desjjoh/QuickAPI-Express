import express from 'express';
import path from 'node:path';
import { HttpListener } from '@/common/handlers/http-lifecycle.handler';
import {
  RequestWorkTracker,
  canRespond,
} from '@/common/handlers/request-lifecycle.handler';

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

let instance: HttpListener | null = null;
let starting: Promise<void> | undefined;
let closing: Promise<void> | undefined;
let shutdownRequested = false;

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
  | 'REQUEST_TIMEOUT_MS'
  | 'RATE_LIMIT_WINDOW_MS'
  | 'RATE_LIMIT_MAX'
  | 'RATE_LIMIT_MAX_CLIENTS'
>;

export function createApp(
  policy: HttpPolicy = env,
  work = new RequestWorkTracker(),
): express.Express {
  const app = express();

  app.set(
    'trust proxy',
    policy.TRUST_PROXY.length ? policy.TRUST_PROXY : false,
  );
  app.disable('x-powered-by');
  app.use(work.admit);

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
      windowMs: policy.RATE_LIMIT_WINDOW_MS,
      max: policy.RATE_LIMIT_MAX,
      maxClients: policy.RATE_LIMIT_MAX_CLIENTS,
      keyGenerator: (req) => req.ip ?? 'unknown',
    }),
  );

  app.use(sanitizeHeaders(policy.CORS_ALLOWED_HEADERS));
  app.use(enforceHeaderLimits());

  app.use(requestTimeout(policy.REQUEST_TIMEOUT_MS));

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

  app.use((req, res, next) => {
    if (canRespond(req, res)) next();
  });

  app.use('/', api_routes);

  app.use('/docs', ...swaggerDocs);
  app.get('/docs-json', docsJson);
  app.get('/redoc', redocDocs);

  app.use(not_found);
  app.use(errorHandler);

  return app;
}

export const registerServer = (): Promise<void> => {
  if (shutdownRequested || closing)
    return Promise.reject(new Error('HTTP server is shutting down.'));
  if (starting) return starting;
  if (instance?.isRunning()) return Promise.resolve();
  const work = new RequestWorkTracker();
  const listener = new HttpListener(createApp(env, work), work, env);

  instance = listener;
  starting = listener
    .start(env.PORT)
    .catch(async (error: unknown) => {
      await listener.close();
      if (instance === listener) instance = null;

      throw error;
    })
    .finally(() => {
      starting = undefined;
    });

  return starting;
};

export const beginServerShutdown = (): void => {
  shutdownRequested = true;
  instance?.quiesce();
};

export const closeServer = (): Promise<void> => {
  if (closing) return closing;
  if (!instance) return Promise.resolve();
  const listener = instance;

  closing = listener.close().finally(() => {
    if (instance === listener) instance = null;
    closing = undefined;
  });

  return closing;
};

export const isServerRunning = (): boolean => {
  return instance?.isRunning() ?? false;
};
