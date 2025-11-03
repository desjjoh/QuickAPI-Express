/**
 * @fileoverview Global Express error-handling middleware.
 * @module middleware/error-handler
 * @description
 *  Centralized middleware for handling application and runtime errors.
 *  Ensures consistent error logging, structured JSON responses, and graceful
 *  failure in production environments.
 *
 * @remarks
 *  - Differentiates between `HttpError` (custom application errors),
 *    validation errors (`ZodError`), and unexpected internal exceptions.
 *  - Integrates with the Pino logger for structured log output.
 *  - Includes contextual metadata such as request method, URL, and request ID.
 *  - Ensures all operational errors return predictable responses.
 *  - Prevents raw stack traces or internal messages from leaking to clients.
 *
 * @example
 *  import { errorHandler } from "@/middleware/error-handler";
 *  app.use(errorHandler);
 */

import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '@/utils/http-error.js';
import { logger } from '@/logger/logger.js';

/**
 * Express global error handler.
 *
 * @param {Error} err - The error thrown during request handling.
 * @param {import("express").Request} req - The current request object.
 * @param {import("express").Response} res - The outgoing response object.
 * @param {import("express").NextFunction} next - The next middleware (unused).
 *
 * @returns Sends a structured JSON response and logs the error.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  void next; // Explicitly mark next as unused to satisfy linters

  let status = 500;
  let message = 'Internal Server Error';

  // ✅ Identify and classify known error types
  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = err.issues.map(e => e.message).join(', ');
  }

  // Log the failure with contextual metadata
  logger.error(
    {
      err,
      method: req.method,
      url: req.originalUrl,
      requestId: res.locals.requestId,
    },
    'Request failed',
  );

  // Send consistent JSON error response
  res.status(status).json({
    status,
    message,
    requestId: res.locals.requestId,
    timestamp: new Date().toISOString(),
  });
};
