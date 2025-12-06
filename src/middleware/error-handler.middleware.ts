import type { ErrorRequestHandler } from 'express';
import z, { ZodError } from 'zod';

import { logger } from '@/config/logger.config';
import { HttpError } from '@/exceptions/http.exception';

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map(issue => {
      const path: string = issue.path.join('.') || 'value';
      return `${path} → ${issue.message}`;
    })
    .join('; ');
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  void next;

  let status: number = 500;
  let message: string = 'Internal Server Error';

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = `Validation failed — ${formatZodIssues(err.issues)}`;
  } else if (err instanceof Error) {
    logger.error({ stack: err.stack }, `Unhandled route error — ${err.message}`);
  }

  res.status(status).json({
    status,
    message,
    timestamp: Date.now(),
  });
};
