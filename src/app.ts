/**
 * @fileoverview Express application factory and middleware configuration.
 * @module app
 * @description
 *  Creates and configures the Express application with logging, security,
 *  compression, rate limiting, and route registration. Serves as the root
 *  composition layer for the API server.
 *
 * @remarks
 *  - All middleware and route registrations are centralized here.
 *  - Security hardening via Helmet and CORS is enabled by default.
 *  - Logging is handled by `pino-http`, integrated with the global `pino` logger.
 *  - Development mode enables verbose request context logging.
 *
 * @example
 *  import { createApp } from '@/app';
 *
 *  const app = createApp();
 *  app.listen(3000);
 */

import express from 'express';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { isDev } from '@/services/env-validation';
import { swaggerDocs } from '@/services/swagger';
import { logger } from '@/services/pino';
import { errorHandler } from '@/core/middleware/error-handler';

import users from '@/api/routes/users';
import health from '@/api/routes/health';

/**
 * Factory function that constructs and configures an Express application instance.
 *
 * @function createApp
 * @returns {import('express').Express} A fully configured Express application ready to run.
 *
 * @example
 *  const app = createApp();
 *  app.listen(env.PORT, () => logger.info(`Server listening on port ${env.PORT}`));
 */
export function createApp(): import('express').Express {
  /** Express application instance. */
  const app = express();

  /**
   * Trust reverse proxy headers (e.g., `X-Forwarded-For`) — required for rate limiting
   * and accurate client IP detection when deployed behind a load balancer.
   */
  app.set('trust proxy', 1);

  /** Structured HTTP request logging via Pino. */
  app.use(pinoHttp({ logger, quietReqLogger: !isDev }));

  /** Request body parsing (JSON + URL-encoded). */
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  /** HTTP security headers — disables conflicting policies for dev/test environments. */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  /** Cross-Origin Resource Sharing (CORS) configuration. */
  app.use(
    cors({
      origin: ['*'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );

  /** Response compression for performance optimization. */
  app.use(compression());

  /**
   * Basic global rate limiting to prevent abuse and DoS attempts.
   * Limit thresholds are environment-aware (`isDev` allows higher limits).
   */
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: isDev ? 1000 : 200,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        status: 429,
        message: 'Too many requests — please slow down.',
      },
      handler: (req, res, _next, options) => {
        req.app.locals.logger?.warn({ ip: req.ip, url: req.originalUrl }, 'Rate limit triggered');
        res.status(options.statusCode).json(options.message);
      },
    }),
  );

  /**
   * Optional development-mode debug logger.
   * Emits request metadata such as IP and User-Agent for diagnostic visibility.
   */
  if (isDev)
    app.use((req, _res, next) => {
      logger.debug({ ip: req.ip, ua: req.headers['user-agent'] }, 'debug: request context');
      next();
    });

  /** Swagger / OpenAPI documentation endpoint. */
  app.use('/docs', ...swaggerDocs);

  /** Health-check route for uptime monitoring and readiness probes. */
  app.use('/', health);

  /** User resource routes (CRUD, authentication, etc.). */
  app.use('/users', users);

  /** Global error handler middleware for consistent JSON error responses. */
  app.use(errorHandler);

  /** Returns the configured Express application. */
  return app;
}
