import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '@/core/utils/http-error.js';
import { logger } from '@/services/pino';

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  void next;

  let status = 500;
  let message = 'Internal Server Error';

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = err.issues.map(e => e.message).join(', ');
  }

  logger.error(
    {
      err,
      method: req.method,
      url: req.originalUrl,
      requestId: res.locals.requestId,
    },
    'Request failed',
  );

  res.status(status).json({
    status,
    message,
    requestId: res.locals.requestId,
    timestamp: new Date().toISOString(),
  });
};
