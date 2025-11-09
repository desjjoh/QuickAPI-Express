import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { HttpError } from '@/core/exceptions/http-error.js';

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
  }

  res.status(status).json({
    status,
    message,
    requestId: res.locals.requestId,
    timestamp: new Date().toISOString(),
  });
};
