/**
 * @fileoverview
 *  HTTP logging middleware for Express.
 *  Provides structured, leveled request/response logging that mirrors
 *  NestJS-style interceptors while maintaining full manual control over output.
 *
 * @module core/middleware/http-logger
 *
 * @description
 *  The `httpLogger` middleware measures request latency and logs contextual
 *  metadata for every completed HTTP transaction. Unlike automated integrations
 *  such as `pino-http`, this implementation allows precise control over log
 *  structure, verbosity, and lifecycle timing.
 *
 * @remarks
 *  - Logs both request start and response completion events.
 *  - Automatically classifies log severity based on HTTP status code:
 *    - 2xx–3xx → info
 *    - 4xx → warn
 *    - 5xx → error
 *  - Attaches response duration, client IP, and method/URL metadata.
 *  - Designed for compatibility with centralized logging backends.
 *
 * @example
 *  ```ts
 *  import express from 'express';
 *  import { httpLogger } from '@/core/middleware/http-logger';
 *
 *  const app = express();
 *  app.use(httpLogger);
 *  app.get('/', (req, res) => res.send('OK'));
 *  ```
 */

import { logger } from '@/services/pino';
import type { Request, Response, NextFunction } from 'express';

/**
 * Logs structured request and response details with latency measurement.
 *
 * @param req - The active Express request.
 * @param res - The active Express response.
 * @param next - The next Express middleware function in the chain.
 *
 * @returns void
 */
export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  const { method, originalUrl } = req;

  // Initial request log (entry point)
  logger.info({ method, url: originalUrl, ip: req.ip }, `[request] → ${method} ${originalUrl}`);

  // Log response details once the request completes
  res.on('finish', () => {
    const duration = (performance.now() - start).toFixed(2);
    const { statusCode } = res;

    const logContext = {
      method,
      url: originalUrl,
      statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    };

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    logger[level](logContext, `[${statusCode}] ${method} / ${originalUrl} → ${duration}ms`);
  });

  next();
}
