import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { logger } from '@/config/logger.config';
import { HttpError } from '@/exceptions/http.exception';

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  void next;

  let status = 500;
  let message = 'Internal Server Error';

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = err.issues.map(e => e.message).join(', ');
  } else if (err instanceof Error) {
    logger.error({ stack: err.stack }, `Unhandled route error — ${err.message}`);
  }

  res.status(status).json({
    status,
    message,
    timestamp: new Date().toISOString(),
  });
};
